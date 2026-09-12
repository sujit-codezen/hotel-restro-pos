from django.db.models import ProtectedError
from rest_framework import viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.generics import CreateAPIView, RetrieveAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated

from accounts.models import Role, StoreStaff
from accounts.serializers import (
    RegisterSerializer,
    RoleSerializer,
    StoreStaffSerializer,
    UserMeSerializer,
)
from core.mixins import OrgScopedViewSetMixin, RequiresPermissionMixin
from core.permissions import IsOrgMember, require_permission


class RegisterView(CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [AllowAny]


class MeView(RetrieveAPIView):
    serializer_class = UserMeSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user


class StoreStaffViewSet(viewsets.ModelViewSet):
    """StoreStaff has no direct `organization` FK (see plan) so it can't
    use OrgScopedViewSetMixin as-is; scoped here via store__organization
    instead."""

    serializer_class = StoreStaffSerializer
    permission_classes = [IsOrgMember]

    def get_queryset(self):
        return StoreStaff.objects.filter(store__organization=self.request.org)

    def _check_cross_org_refs(self, serializer):
        # Without OrgScopedViewSetMixin's store-ownership check, nothing
        # else stops a client from assigning a StoreStaff row to another
        # org's store or role — both are FKs a request can set directly.
        store = serializer.validated_data.get("store")
        if store is not None and store.organization_id != self.request.org.id:
            raise ValidationError({"store": "Store does not belong to your organization."})
        role = serializer.validated_data.get("role")
        if role is not None and role.organization_id != self.request.org.id:
            raise ValidationError({"role": "Role does not belong to your organization."})

    def perform_create(self, serializer):
        require_permission(
            self.request, "can_manage_staff", store=serializer.validated_data.get("store")
        )
        self._check_cross_org_refs(serializer)
        serializer.save()

    def perform_update(self, serializer):
        require_permission(self.request, "can_manage_staff", store=serializer.instance.store)
        self._check_cross_org_refs(serializer)
        serializer.save()

    def perform_destroy(self, instance):
        require_permission(self.request, "can_manage_staff", store=instance.store)
        instance.delete()


class RoleViewSet(RequiresPermissionMixin, OrgScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = RoleSerializer
    permission_classes = [IsOrgMember]
    queryset = Role.objects.all()
    # Role has no `store` field (it's org-wide) — RequiresPermissionMixin
    # falls back to an org-wide check. Managing who-can-do-what is treated
    # as part of managing staff, not a separate permission flag.
    required_permission = "can_manage_staff"

    def perform_destroy(self, instance):
        require_permission(self.request, "can_manage_staff", store=None)
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError(
                "This role is still assigned to staff — reassign them before deleting it."
            )
