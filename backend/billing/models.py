import uuid

from django.db import models

from core.models import BaseTenantModel


class InvoiceCounter(BaseTenantModel):
    """Backs the per-store, per-year sequential counter used by
    billing.services.next_display_number(). One row per (store, year)."""

    store = models.ForeignKey(
        "organizations.Store", on_delete=models.CASCADE, related_name="invoice_counters"
    )
    year = models.PositiveIntegerField()
    last_value = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = ("store", "year")


class Discount(BaseTenantModel):
    class Type(models.TextChoices):
        PERCENT = "PERCENT", "Percent"
        FIXED = "FIXED", "Fixed amount"

    name = models.CharField(max_length=120)
    type = models.CharField(max_length=10, choices=Type.choices)
    value = models.DecimalField(max_digits=10, decimal_places=2)

    def __str__(self):
        return self.name


class Invoice(BaseTenantModel):
    class SourceType(models.TextChoices):
        ORDER = "ORDER", "Order"
        FOLIO = "FOLIO", "Folio"

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        UNPAID = "UNPAID", "Unpaid"
        PARTIALLY_PAID = "PARTIALLY_PAID", "Partially paid"
        PAID = "PAID", "Paid"
        VOID = "VOID", "Void"

    store = models.ForeignKey(
        "organizations.Store", on_delete=models.CASCADE, related_name="invoices"
    )
    idempotency_key = models.UUIDField(default=uuid.uuid4, unique=True)
    source_type = models.CharField(max_length=10, choices=SourceType.choices)
    # ForeignKey, not OneToOne: a split bill produces more than one Invoice
    # per Order (see Order.bill(item_ids=...) / split_bill service).
    order = models.ForeignKey(
        "orders.Order",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="invoices",
    )
    folio = models.OneToOneField(
        "hotel.Folio",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="settlement_invoice",
    )
    customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="invoices",
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    # `discount` records which Discount produced discount_total (for
    # reporting/audit); discount_total is the computed amount and is what
    # recompute_totals() actually uses — set together by apply_discount(),
    # never by hand, so they can't drift apart.
    discount = models.ForeignKey(
        Discount, on_delete=models.SET_NULL, null=True, blank=True, related_name="invoices"
    )
    discount_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    tax_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    grand_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    # Assigned only at finalize() via a per-store counter — best-effort
    # sequential, not a strict no-gap legal sequence. See plan section 1.
    # Unique per store, not globally: two different stores' counters both
    # start at 1, so "INV-2026-000001" legitimately exists at each store.
    display_number = models.CharField(max_length=40, null=True, blank=True)
    finalized_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["organization", "status"])]
        constraints = [
            models.UniqueConstraint(
                fields=["store", "display_number"],
                name="unique_display_number_per_store",
                condition=models.Q(display_number__isnull=False),
            )
        ]

    def __str__(self):
        return self.display_number or f"DRAFT-{self.id}"

    def recompute_totals(self):
        lines = self.lines.all()
        self.subtotal = sum((l.quantity * l.unit_price for l in lines), start=0)
        self.tax_total = sum((l.tax_amount for l in lines), start=0)
        self.grand_total = self.subtotal - self.discount_total + self.tax_total
        self.save(update_fields=["subtotal", "tax_total", "grand_total"])

    def apply_discount(self, discount):
        """Sets discount_total from `discount` and recomputes grand_total.
        Only allowed with nothing paid yet — changing the total after money
        has changed hands would desync it from what was actually collected
        (the same reasoning as void()'s outstanding-balance guard)."""
        from decimal import ROUND_HALF_UP, Decimal

        from django.core.exceptions import ValidationError

        if self._net_paid() > 0:
            raise ValidationError("Cannot change the discount after a payment has been recorded.")

        if discount.type == Discount.Type.PERCENT:
            amount = (self.subtotal * discount.value / Decimal("100")).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
        else:
            amount = discount.value
        # Never let a discount take the invoice below zero.
        self.discount_total = min(amount, self.subtotal)
        self.discount = discount
        self.save(update_fields=["discount", "discount_total"])
        self.recompute_totals()

    def remove_discount(self):
        from django.core.exceptions import ValidationError

        if self._net_paid() > 0:
            raise ValidationError("Cannot change the discount after a payment has been recorded.")
        self.discount = None
        self.discount_total = 0
        self.save(update_fields=["discount", "discount_total"])
        self.recompute_totals()

    def finalize(self):
        """Assigns display_number via a per-store transactional counter and
        stamps finalized_at. Does NOT set status directly — a payment may
        already have been recorded against this DRAFT invoice (payments can
        be taken before or after finalize), so status is always derived
        fresh from actual Payments via _status_from_payments(), never
        hardcoded here. Must run inside a transaction with select_for_update
        on the counter row to stay collision-free under concurrent
        checkouts at the same store."""
        from django.db import transaction
        from django.utils import timezone

        from billing.services import next_display_number

        with transaction.atomic():
            if not self.display_number:
                self.display_number = next_display_number(self.store)
            self.status = self._status_from_payments()
            self.finalized_at = timezone.now()
            self.save(update_fields=["display_number", "status", "finalized_at"])
        return self

    def _net_paid(self):
        # A DB aggregate, not self.payments.all() — this instance may have
        # come from a prefetch_related queryset (e.g. InvoiceViewSet's
        # get_object()) whose cached payments were fetched before a
        # just-created Payment existed, which would silently make this
        # look unpaid. Same bug class as the Order.items staleness fixed
        # in orders/views.py add_item — aggregate() always hits the DB.
        from django.db.models import Sum

        paid = self.payments.aggregate(total=Sum("amount"))["total"] or 0
        refunded = Refund.objects.filter(payment__invoice=self).aggregate(total=Sum("amount"))[
            "total"
        ] or 0
        return paid - refunded

    def _status_from_payments(self):
        paid = self._net_paid()
        if paid <= 0:
            return self.Status.UNPAID
        if paid < self.grand_total:
            return self.Status.PARTIALLY_PAID
        return self.Status.PAID

    def apply_payment(self):
        """Recomputes status from the net of Payments minus Refunds. Call
        after creating/deleting a Payment or a Refund."""
        self.status = self._status_from_payments()
        self.save(update_fields=["status"])

    def void(self):
        """Cancels an invoice that was never actually collected. Refuses to
        void one with money still outstanding on it (net paid > 0) — refund
        it first. Known limitation: for a split-billed ORDER invoice, this
        does NOT free its OrderItems back up (item.invoice stays set), so
        a voided split can't currently be re-billed from the same order —
        the items just stay permanently attached to the voided invoice.
        Fine for the "this shouldn't have been rung up, refund handles the
        money" case void() is built for; a "let me redo it" flow would need
        that follow-up.
        the payments first, so a void can never make a real payment vanish
        from the books without a Refund record explaining where it went."""
        from django.core.exceptions import ValidationError

        if self._net_paid() > 0:
            raise ValidationError(
                "Refund this invoice's payments before voiding it."
            )
        self.status = self.Status.VOID
        self.save(update_fields=["status"])


class InvoiceLine(BaseTenantModel):
    class SourceType(models.TextChoices):
        MENU_ITEM = "MENU_ITEM", "Menu item"
        ROOM_CHARGE = "ROOM_CHARGE", "Room charge"
        SERVICE_CHARGE = "SERVICE_CHARGE", "Service charge"
        ADJUSTMENT = "ADJUSTMENT", "Adjustment"

    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="lines")
    description = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=1)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    tax_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    source_type = models.CharField(max_length=20, choices=SourceType.choices)

    def __str__(self):
        return f"{self.description} x{self.quantity}"


class Payment(BaseTenantModel):
    class Method(models.TextChoices):
        CASH = "CASH", "Cash"
        CARD = "CARD", "Card"
        ESEWA = "ESEWA", "eSewa"
        KHALTI = "KHALTI", "Khalti"
        QR = "QR", "QR"
        BANK_TRANSFER = "BANK_TRANSFER", "Bank transfer"

    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="payments")
    method = models.CharField(max_length=20, choices=Method.choices)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    reference_number = models.CharField(max_length=120, blank=True)
    received_by = models.ForeignKey(
        "accounts.StoreStaff", on_delete=models.SET_NULL, null=True, blank=True
    )
    received_at = models.DateTimeField(auto_now_add=True)
    change_given = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )

    def __str__(self):
        return f"{self.method} {self.amount}"

    def refunded_amount(self):
        from django.db.models import Sum

        return self.refunds.aggregate(total=Sum("amount"))["total"] or 0

    def refundable_amount(self):
        return self.amount - self.refunded_amount()

    def refund(self, amount, reason="", refunded_by=None):
        """Creates a Refund against this payment and recomputes the
        invoice's status. Rejects refunding more than what's left
        unrefunded on this specific payment — refundable_amount(), not
        self.amount, since a payment can be partially refunded more than
        once."""
        from django.core.exceptions import ValidationError
        from django.db import transaction

        if amount <= 0:
            raise ValidationError("Refund amount must be positive.")
        if amount > self.refundable_amount():
            raise ValidationError("Refund amount exceeds what's left unrefunded on this payment.")

        with transaction.atomic():
            refund = Refund.objects.create(
                organization=self.organization,
                payment=self,
                amount=amount,
                reason=reason,
                refunded_by=refunded_by,
            )
            self.invoice.apply_payment()
        return refund


class Refund(BaseTenantModel):
    payment = models.ForeignKey(Payment, on_delete=models.CASCADE, related_name="refunds")
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    reason = models.CharField(max_length=255, blank=True)
    refunded_by = models.ForeignKey(
        "accounts.StoreStaff", on_delete=models.SET_NULL, null=True, blank=True
    )

    def __str__(self):
        return f"Refund {self.amount} on {self.payment}"
