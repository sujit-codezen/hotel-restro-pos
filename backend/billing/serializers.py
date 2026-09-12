from rest_framework import serializers

from billing.models import Discount, Invoice, InvoiceLine, Payment, Refund


class InvoiceLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceLine
        fields = ["id", "description", "quantity", "unit_price", "tax_amount", "source_type"]
        read_only_fields = ["id"]


class RefundSerializer(serializers.ModelSerializer):
    class Meta:
        model = Refund
        fields = ["id", "payment", "amount", "reason", "refunded_by", "created_at"]
        read_only_fields = ["id", "created_at"]


class RefundCreateSerializer(serializers.Serializer):
    payment_id = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=10, decimal_places=2)
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class PaymentSerializer(serializers.ModelSerializer):
    refunds = RefundSerializer(many=True, read_only=True)
    refundable_amount = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = [
            "id", "invoice", "method", "amount", "reference_number",
            "received_by", "received_at", "change_given", "refunds", "refundable_amount",
        ]
        read_only_fields = ["id", "received_at"]

    def get_refundable_amount(self, obj):
        return obj.refundable_amount()


class PaymentCreateSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=Payment.Method.choices)
    amount = serializers.DecimalField(max_digits=10, decimal_places=2)
    reference_number = serializers.CharField(required=False, allow_blank=True, default="")
    tendered_amount = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True, default=None
    )


class InvoiceSerializer(serializers.ModelSerializer):
    lines = InvoiceLineSerializer(many=True, read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)
    balance_due = serializers.SerializerMethodField()
    discount_name = serializers.CharField(source="discount.name", read_only=True, default=None)

    class Meta:
        model = Invoice
        fields = [
            "id", "store", "source_type", "order", "folio", "customer", "status",
            "subtotal", "discount", "discount_name", "discount_total", "tax_total",
            "grand_total", "display_number", "finalized_at", "created_at", "lines",
            "payments", "balance_due",
        ]
        # discount/discount_total are set only via Invoice.apply_discount()/
        # remove_discount() (the /discount/ action below), never a plain
        # PATCH — that's what keeps discount_total always in sync with the
        # Discount it was computed from.
        read_only_fields = [
            f for f in fields
            if f not in ("customer", "lines", "payments", "balance_due", "discount_name")
        ]

    def get_balance_due(self, obj):
        # Net of refunds, not just gross payments — a fully refunded
        # invoice must show its full grand_total as due again, not $0.
        return obj.grand_total - obj._net_paid()


class DiscountSerializer(serializers.ModelSerializer):
    class Meta:
        model = Discount
        fields = ["id", "name", "type", "value"]
        read_only_fields = ["id"]


class ApplyDiscountSerializer(serializers.Serializer):
    discount_id = serializers.UUIDField()
