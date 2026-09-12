from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import StoreStaff
from accounts.services import seed_default_roles
from core.mixins import OrgScopedViewSetMixin, RequiresPermissionMixin
from core.permissions import IsOrgMember, require_permission
from organizations.models import Organization, Store
from organizations.serializers import (
    OnboardingSerializer,
    OrganizationSerializer,
    StoreSerializer,
)


class OnboardingView(APIView):
    """POST {name, business_type} -> creates the Organization + Store(s),
    seeds the default Role set, and attaches the requesting user to the
    org as Owner on every store created. A user may only onboard once (no
    organization yet)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if request.user.organization_id:
            return Response(
                {"detail": "User already belongs to an organization."}, status=400
            )
        serializer = OnboardingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        org = serializer.save()

        request.user.organization = org
        request.user.save(update_fields=["organization"])
        roles = seed_default_roles(org)
        for store in org.stores.all():
            StoreStaff.objects.create(user=request.user, store=store, role=roles["Owner"])
        return Response(OrganizationSerializer(org).data, status=201)


class OrganizationView(APIView):
    permission_classes = [IsOrgMember]

    def get(self, request):
        return Response(OrganizationSerializer(request.org).data)

    def patch(self, request):
        require_permission(request, "can_access_settings")
        serializer = OrganizationSerializer(request.org, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class StoreViewSet(RequiresPermissionMixin, OrgScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = StoreSerializer
    permission_classes = [IsOrgMember]
    queryset = Store.objects.all()
    required_permission = "can_access_settings"
