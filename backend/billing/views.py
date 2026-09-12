from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.shortcuts import get_object_or_404
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from billing.models import Discount, Invoice, Payment
from billing.serializers import (
    ApplyDiscountSerializer,
    DiscountSerializer,
    InvoiceSerializer,
    PaymentCreateSerializer,
    PaymentSerializer,
    RefundCreateSerializer,
)
from core.mixins import OrgScopedViewSetMixin, RequiresPermissionMixin
from core.permissions import IsOrgMember, require_permission


class InvoiceViewSet(
    OrgScopedViewSetMixin,
    mixins.RetrieveModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    """Invoices are created via Order.bill() / Folio.close(), not directly
    through this API — see plan section 1. This ViewSet is read + the
    payments/finalize/receipt/refund/void actions."""

    serializer_class = InvoiceSerializer
    permission_classes = [IsOrgMember]
    queryset = Invoice.objects.prefetch_related("lines", "payments__refunds")
    filterset_fields = ["store", "status", "source_type", "order", "folio", "customer"]

    def _current_staff(self, request, store):
        return request.user.store_assignments.filter(store=store, is_active=True).first()

    @action(detail=True, methods=["post"], url_path="payments")
    def add_payment(self, request, pk=None):
        invoice = self.get_object()
        serializer = PaymentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        change_given = None
        if data["method"] == Payment.Method.CASH and data["tendered_amount"] is not None:
            change_given = max(Decimal("0"), data["tendered_amount"] - data["amount"])

        Payment.objects.create(
            organization=invoice.organization,
            invoice=invoice,
            method=data["method"],
            amount=data["amount"],
            reference_number=data["reference_number"],
            received_by=self._current_staff(request, invoice.store),
            change_given=change_given,
        )
        invoice.apply_payment()
        # invoice.payments was prefetched by get_object() before this
        # payment existed; re-fetch so the response includes it (same
        # staleness class as the Order.items fix in orders/views.py).
        invoice = self.get_queryset().get(pk=invoice.pk)
        return Response(InvoiceSerializer(invoice).data, status=201)

    @action(detail=True, methods=["post"], url_path="refund")
    def refund(self, request, pk=None):
        invoice = self.get_object()
        require_permission(request, "can_refund_or_void", store=invoice.store)
        serializer = RefundCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        payment = get_object_or_404(
            Payment, id=data["payment_id"], invoice=invoice, organization=request.org
        )
        try:
            payment.refund(
                amount=data["amount"],
                reason=data["reason"],
                refunded_by=self._current_staff(request, invoice.store),
            )
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages)
        # Same staleness class as add_payment above — invoice.payments and
        # each payment's .refunds were prefetched before this refund existed.
        invoice = self.get_queryset().get(pk=invoice.pk)
        return Response(InvoiceSerializer(invoice).data, status=201)

    @action(detail=True, methods=["post", "delete"], url_path="discount")
    def discount(self, request, pk=None):
        invoice = self.get_object()
        try:
            if request.method == "DELETE":
                invoice.remove_discount()
            else:
                serializer = ApplyDiscountSerializer(data=request.data)
                serializer.is_valid(raise_exception=True)
                discount = get_object_or_404(
                    Discount, id=serializer.validated_data["discount_id"], organization=request.org
                )
                invoice.apply_discount(discount)
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages)
        invoice = self.get_queryset().get(pk=invoice.pk)
        return Response(InvoiceSerializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="void")
    def void(self, request, pk=None):
        invoice = self.get_object()
        require_permission(request, "can_refund_or_void", store=invoice.store)
        try:
            invoice.void()
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages)
        return Response(InvoiceSerializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="finalize")
    def finalize(self, request, pk=None):
        invoice = self.get_object()
        invoice.finalize()
        return Response(InvoiceSerializer(invoice).data)

    @action(detail=True, methods=["get"], url_path="receipt")
    def receipt(self, request, pk=None):
        invoice = self.get_object()
        return Response(InvoiceSerializer(invoice).data)


class DiscountViewSet(RequiresPermissionMixin, OrgScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = DiscountSerializer
    permission_classes = [IsOrgMember]
    queryset = Discount.objects.all()
    # Discount has no `store` field, so RequiresPermissionMixin's check
    # falls back to org-wide (any store where the user has the flag).
    required_permission = "can_manage_discounts"
