from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from core.mixins import OrgScopedViewSetMixin
from core.permissions import IsOrgMember
from tables.models import Table
from tables.serializers import TableSerializer


class TableViewSet(OrgScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = TableSerializer
    permission_classes = [IsOrgMember]
    queryset = Table.objects.all()
    filterset_fields = ["store", "status"]

    def perform_destroy(self, instance):
        # Order.table is SET_NULL, so deleting an occupied table wouldn't
        # crash — it would just silently disconnect an in-progress order
        # from its table, which is worse: the order becomes unreachable
        # from the floor view with nothing telling the cashier where it went.
        if instance.status == Table.Status.OCCUPIED:
            raise ValidationError(
                "This table has an order in progress — finish or cancel it before deleting."
            )
        instance.delete()

    @action(detail=False, methods=["get"], url_path="floor-view")
    def floor_view(self, request):
        store_id = request.query_params.get("store")
        qs = self.get_queryset()
        if store_id:
            qs = qs.filter(store_id=store_id)
        return Response(TableSerializer(qs, many=True).data)

    @action(detail=True, methods=["patch"], url_path="status")
    def set_status(self, request, pk=None):
        table = self.get_object()
        status_value = request.data.get("status")
        if status_value not in Table.Status.values:
            return Response({"detail": "Invalid status."}, status=400)
        table.status = status_value
        table.save(update_fields=["status"])
        return Response(TableSerializer(table).data)
