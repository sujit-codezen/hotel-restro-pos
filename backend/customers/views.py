from django.db.models import Q
from rest_framework import viewsets

from core.mixins import OrgScopedViewSetMixin
from core.permissions import IsOrgMember
from customers.models import Customer
from customers.serializers import CustomerSerializer


class CustomerViewSet(OrgScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = CustomerSerializer
    permission_classes = [IsOrgMember]
    queryset = Customer.objects.all()

    def get_queryset(self):
        qs = super().get_queryset()
        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(Q(phone__icontains=search) | Q(name__icontains=search))
        return qs
