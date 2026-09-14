from django.db import transaction
from django.db.models import ProtectedError
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.generics import CreateAPIView, RetrieveAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from accounts.models import Role, StoreStaff, User
from accounts.serializers import (
    InviteStaffSerializer,
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
        return StoreStaff.objects.filter(store__organization=self.request.org).select_related(
            "user", "role"
        ).order_by("user__email")

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

    @action(detail=False, methods=["post"])
    def invite(self, request):
        """The org-scoped counterpart to /auth/register/ (which is
        AllowAny and deliberately leaves a self-signed-up user org-less
        until they complete onboarding). This is what the Staff page
        actually calls: it creates the user pre-attached to request.org so
        they land straight in the dashboard on first login instead of
        being bounced to "Set up your business"."""
        serializer = InviteStaffSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        store, role = data["store"], data["role"]

        require_permission(request, "can_manage_staff", store=store)
        if store.organization_id != request.org.id:
            raise ValidationError({"store": "Store does not belong to your organization."})
        if role.organization_id != request.org.id:
            raise ValidationError({"role": "Role does not belong to your organization."})

        with transaction.atomic():
            user = User.objects.create_user(
                email=data["email"],
                password=data["password"],
                first_name=data["first_name"],
                organization=request.org,
            )
            staff = StoreStaff.objects.create(user=user, store=store, role=role)
        return Response(StoreStaffSerializer(staff).data, status=201)


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
