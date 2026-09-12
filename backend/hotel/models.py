from django.db import models

from core.models import BaseTenantModel


class RoomType(BaseTenantModel):
    store = models.ForeignKey(
        "organizations.Store", on_delete=models.CASCADE, related_name="room_types"
    )
    name = models.CharField(max_length=120)
    base_rate = models.DecimalField(max_digits=10, decimal_places=2)
    capacity = models.PositiveIntegerField(default=2)

    class Meta:
        unique_together = ("store", "name")
        ordering = ["name"]

    def __str__(self):
        return self.name


class Room(BaseTenantModel):
    class Status(models.TextChoices):
        AVAILABLE = "AVAILABLE", "Available"
        OCCUPIED = "OCCUPIED", "Occupied"
        DIRTY = "DIRTY", "Dirty"
        MAINTENANCE = "MAINTENANCE", "Maintenance"

    store = models.ForeignKey(
        "organizations.Store", on_delete=models.CASCADE, related_name="rooms"
    )
    room_type = models.ForeignKey(RoomType, on_delete=models.PROTECT, related_name="rooms")
    number = models.CharField(max_length=20)
    floor = models.CharField(max_length=20, blank=True)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.AVAILABLE
    )

    class Meta:
        unique_together = ("store", "number")
        ordering = ["number"]

    def __str__(self):
        return f"Room {self.number}"


class Reservation(BaseTenantModel):
    class Status(models.TextChoices):
        BOOKED = "BOOKED", "Booked"
        CHECKED_IN = "CHECKED_IN", "Checked in"
        CHECKED_OUT = "CHECKED_OUT", "Checked out"
        CANCELLED = "CANCELLED", "Cancelled"
        NO_SHOW = "NO_SHOW", "No show"

    # A reservation still holds its room ("active") vs. one that no longer
    # does ("inactive") — used both for the overlap check below and for
    # the frontend's Active/Inactive split.
    ACTIVE_STATUSES = (Status.BOOKED, Status.CHECKED_IN)
    INACTIVE_STATUSES = (Status.CHECKED_OUT, Status.CANCELLED, Status.NO_SHOW)

    store = models.ForeignKey(
        "organizations.Store", on_delete=models.CASCADE, related_name="reservations"
    )
    guest = models.ForeignKey(
        "customers.Customer", on_delete=models.PROTECT, related_name="reservations"
    )
    room_type = models.ForeignKey(RoomType, on_delete=models.PROTECT)
    room = models.ForeignKey(
        Room, on_delete=models.SET_NULL, null=True, blank=True, related_name="reservations"
    )
    check_in_date = models.DateField()
    check_out_date = models.DateField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.BOOKED)
    adults = models.PositiveIntegerField(default=1)
    children = models.PositiveIntegerField(default=0)
    rate_per_night = models.DecimalField(max_digits=10, decimal_places=2)

    def __str__(self):
        return f"{self.guest} {self.check_in_date}→{self.check_out_date}"

    @classmethod
    def room_is_available_for(cls, room, check_in_date, check_out_date, exclude_id=None):
        """False if `room` is already held by another still-active
        (BOOKED/CHECKED_IN) reservation whose date range overlaps this one
        — the standard half-open interval test, so a checkout on the same
        day as the next check-in doesn't count as a conflict."""
        conflicting = cls.objects.filter(
            room=room,
            status__in=cls.ACTIVE_STATUSES,
            check_in_date__lt=check_out_date,
            check_out_date__gt=check_in_date,
        )
        if exclude_id:
            conflicting = conflicting.exclude(id=exclude_id)
        return not conflicting.exists()


class ReservationFoodItem(BaseTenantModel):
    """A food item pre-ordered against a reservation before the guest has
    checked in — there's no Folio yet at that point (one is only created
    at check-in), so this is where a pre-order lives until then.
    ReservationViewSet.check_in copies each of these onto the new folio as
    a RESTAURANT_CHARGE line, the same way the room charge itself is
    seeded — see check_in()."""

    reservation = models.ForeignKey(Reservation, on_delete=models.CASCADE, related_name="food_items")
    menu_item = models.ForeignKey("catalog.MenuItem", on_delete=models.PROTECT)
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=1)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    notes = models.CharField(max_length=255, blank=True)

    def __str__(self):
        return f"{self.menu_item.name} x{self.quantity}"


class GuestStay(BaseTenantModel):
    class Status(models.TextChoices):
        IN_HOUSE = "IN_HOUSE", "In house"
        CHECKED_OUT = "CHECKED_OUT", "Checked out"

    store = models.ForeignKey(
        "organizations.Store", on_delete=models.CASCADE, related_name="guest_stays"
    )
    reservation = models.ForeignKey(
        Reservation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stays",
    )
    room = models.ForeignKey(Room, on_delete=models.PROTECT, related_name="stays")
    guest = models.ForeignKey(
        "customers.Customer", on_delete=models.PROTECT, related_name="stays"
    )
    check_in_at = models.DateTimeField(auto_now_add=True)
    check_out_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.IN_HOUSE)

    def __str__(self):
        return f"{self.guest} in {self.room}"


class Folio(BaseTenantModel):
    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        CLOSED = "CLOSED", "Closed"

    store = models.ForeignKey(
        "organizations.Store", on_delete=models.CASCADE, related_name="folios"
    )
    guest_stay = models.OneToOneField(
        GuestStay, on_delete=models.CASCADE, related_name="folio"
    )
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    opened_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Folio for {self.guest_stay}"

    def total(self):
        return sum((l.amount for l in self.lines.all()), start=0)

    def total_deposits(self):
        return sum((d.amount for d in self.deposits.all()), start=0)

    def close(self):
        """Creates the settlement Invoice from every FolioLine (room +
        restaurant + service charges combined into one invoice), per the
        plan's Phase 1 decision to settle once at checkout only. Any
        advance/deposit payments taken during the stay (FolioDeposit) are
        carried over onto the new invoice as real Payments, so what the
        guest already handed over is credited automatically instead of
        being charged again at checkout."""
        from django.db import transaction
        from django.utils import timezone

        from billing.models import Invoice, InvoiceLine, Payment

        with transaction.atomic():
            invoice = Invoice.objects.create(
                organization=self.organization,
                store=self.store,
                source_type=Invoice.SourceType.FOLIO,
                folio=self,
                customer=self.guest_stay.guest,
            )
            for line in self.lines.all():
                InvoiceLine.objects.create(
                    organization=self.organization,
                    invoice=invoice,
                    description=line.description,
                    quantity=line.quantity,
                    unit_price=line.unit_price,
                    tax_amount=line.tax_amount,
                    source_type=self._invoice_line_source_type(line.line_type),
                )
            invoice.recompute_totals()
            for deposit in self.deposits.all():
                Payment.objects.create(
                    organization=self.organization,
                    invoice=invoice,
                    method=deposit.method,
                    amount=deposit.amount,
                    reference_number=deposit.reference_number,
                    received_by=deposit.received_by,
                )
            if self.deposits.exists():
                invoice.apply_payment()
            self.status = self.Status.CLOSED
            self.closed_at = timezone.now()
            self.save(update_fields=["status", "closed_at"])
        return invoice

    @staticmethod
    def _invoice_line_source_type(folio_line_type):
        from billing.models import InvoiceLine

        return {
            FolioLine.LineType.ROOM_CHARGE: InvoiceLine.SourceType.ROOM_CHARGE,
            FolioLine.LineType.RESTAURANT_CHARGE: InvoiceLine.SourceType.MENU_ITEM,
        }.get(folio_line_type, InvoiceLine.SourceType.SERVICE_CHARGE)


class FolioLine(BaseTenantModel):
    class LineType(models.TextChoices):
        ROOM_CHARGE = "ROOM_CHARGE", "Room charge"
        RESTAURANT_CHARGE = "RESTAURANT_CHARGE", "Restaurant charge"
        SERVICE = "SERVICE", "Service"
        LAUNDRY = "LAUNDRY", "Laundry"
        MISC = "MISC", "Misc"

    folio = models.ForeignKey(Folio, on_delete=models.CASCADE, related_name="lines")
    line_type = models.CharField(max_length=20, choices=LineType.choices)
    description = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=1)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    tax_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    source_order = models.ForeignKey(
        "orders.Order",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="folio_lines",
    )
    created_by = models.ForeignKey(
        "accounts.StoreStaff", on_delete=models.SET_NULL, null=True, blank=True
    )

    def __str__(self):
        return f"{self.description} ({self.amount})"


class FolioDeposit(BaseTenantModel):
    """An advance/deposit payment taken mid-stay, before there's an
    Invoice to attach a real billing.Payment to (Invoices are only created
    at Folio.close(), per the plan's Phase 1 settle-once-at-checkout
    decision). Folio.close() converts every deposit on the folio into a
    real Payment on the settlement Invoice, so it's credited automatically
    rather than being collected twice."""

    class Method(models.TextChoices):
        CASH = "CASH", "Cash"
        CARD = "CARD", "Card"
        ESEWA = "ESEWA", "eSewa"
        KHALTI = "KHALTI", "Khalti"
        QR = "QR", "QR"
        BANK_TRANSFER = "BANK_TRANSFER", "Bank transfer"

    folio = models.ForeignKey(Folio, on_delete=models.CASCADE, related_name="deposits")
    method = models.CharField(max_length=20, choices=Method.choices)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    reference_number = models.CharField(max_length=120, blank=True)
    received_by = models.ForeignKey(
        "accounts.StoreStaff", on_delete=models.SET_NULL, null=True, blank=True
    )
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-received_at"]

    def __str__(self):
        return f"Deposit {self.amount} on {self.folio}"
