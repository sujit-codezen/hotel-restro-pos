from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models

from core.models import BaseTenantModel


class Order(BaseTenantModel):
    class OrderType(models.TextChoices):
        DINE_IN = "DINE_IN", "Dine in"
        TAKEAWAY = "TAKEAWAY", "Takeaway"
        DELIVERY = "DELIVERY", "Delivery"
        ROOM_SERVICE = "ROOM_SERVICE", "Room service"

    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        HELD = "HELD", "Held"
        SENT_TO_KITCHEN = "SENT_TO_KITCHEN", "Sent to kitchen"
        READY = "READY", "Ready"
        SERVED = "SERVED", "Served"
        BILLED = "BILLED", "Billed"
        CHARGED_TO_ROOM = "CHARGED_TO_ROOM", "Charged to room"
        CANCELLED = "CANCELLED", "Cancelled"

    store = models.ForeignKey(
        "organizations.Store", on_delete=models.CASCADE, related_name="orders"
    )
    order_type = models.CharField(max_length=20, choices=OrderType.choices)
    table = models.ForeignKey(
        "tables.Table", on_delete=models.SET_NULL, null=True, blank=True, related_name="orders"
    )
    customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="orders",
    )
    guest_stay = models.ForeignKey(
        "hotel.GuestStay",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="orders",
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    created_by = models.ForeignKey(
        "accounts.StoreStaff", on_delete=models.SET_NULL, null=True, blank=True
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Order {self.id} ({self.status})"

    def _describe_item(self, item):
        modifiers_total = sum((m.price_delta for m in item.modifiers.all()), start=0)
        unit_price = item.unit_price + modifiers_total
        desc = item.menu_item.name
        mods = ", ".join(m.modifier.name for m in item.modifiers.all())
        if mods:
            desc = f"{desc} ({mods})"

        # Exclusive tax only: computed on top of unit_price and added to
        # grand_total by Invoice.recompute_totals(). An inclusive TaxClass
        # (tax already folded into the listed price) would need
        # recompute_totals() to NOT add it again — that split isn't wired
        # up yet, so inclusive-tax items still report tax_amount=0 rather
        # than risk silently double-charging the customer.
        tax_class = item.menu_item.tax_class
        line_total = unit_price * item.quantity
        if tax_class and not tax_class.is_inclusive:
            tax_amount = (line_total * tax_class.rate_percent / Decimal("100")).quantize(
                Decimal("0.01")
            )
        else:
            tax_amount = Decimal("0.00")
        return desc, item.quantity, unit_price, tax_amount

    def _line_items(self):
        for item in self.items.select_related("menu_item").prefetch_related("modifiers"):
            yield self._describe_item(item)

    def unbilled_items(self):
        """Items not yet attached to any Invoice — what a plain bill() or
        an item-selecting split bill still has left to charge. Excludes
        cancelled items outright: a cancelled item is never billable,
        cancelled before or after this order gets billed."""
        return self.items.filter(invoice__isnull=True).exclude(status=OrderItem.Status.CANCELLED)

    def bill(self, item_ids=None):
        """Pay-now path: dine-in/takeaway/delivery. Creates an Invoice from
        this order's unbilled items — all of them by default, or only
        `item_ids` for a split bill (e.g. splitting a table's check across
        two invoices). Order.status only moves to BILLED once every item
        has been attached to some invoice; a partial split leaves it as-is
        so the remainder can still be billed later. See plan section 1,
        'Resolution flow', and the Phase 2 split-bill addition."""
        from django.db import transaction

        from billing.models import Invoice, InvoiceLine

        with transaction.atomic():
            items = self.unbilled_items().select_related("menu_item").prefetch_related(
                "modifiers"
            )
            if item_ids is not None:
                items = items.filter(id__in=item_ids)
            items = list(items)
            if not items:
                raise ValidationError("No unbilled items to bill.")

            invoice = Invoice.objects.create(
                organization=self.organization,
                store=self.store,
                source_type=Invoice.SourceType.ORDER,
                order=self,
                customer=self.customer,
            )
            for item in items:
                description, quantity, unit_price, tax_amount = self._describe_item(item)
                InvoiceLine.objects.create(
                    organization=self.organization,
                    invoice=invoice,
                    description=description,
                    quantity=quantity,
                    unit_price=unit_price,
                    tax_amount=tax_amount,
                    source_type=InvoiceLine.SourceType.MENU_ITEM,
                )
                item.invoice = invoice
                item.save(update_fields=["invoice"])
            invoice.recompute_totals()

            if not self.unbilled_items().exists():
                self.status = self.Status.BILLED
                self.save(update_fields=["status"])
        return invoice

    def merge_from(self, other_order):
        """Moves every item from `other_order` onto this order (e.g. two
        tables' guests decide to share a check) and cancels `other_order`.
        Both orders must still be open (not yet billed/charged/cancelled) —
        merging into or out of an already-billed order would silently
        orphan items relative to invoices already created from them."""
        from django.db import transaction

        terminal_statuses = {
            self.Status.BILLED,
            self.Status.CHARGED_TO_ROOM,
            self.Status.CANCELLED,
        }
        if self.status in terminal_statuses or other_order.status in terminal_statuses:
            raise ValidationError("Cannot merge a billed, charged, or cancelled order.")
        if self.id == other_order.id:
            raise ValidationError("Cannot merge an order into itself.")

        with transaction.atomic():
            other_order.items.update(order=self)
            other_table = other_order.table
            other_order.table = None
            other_order.status = self.Status.CANCELLED
            other_order.save(update_fields=["table", "status"])
            if other_table is not None:
                from tables.models import Table

                other_table.status = Table.Status.AVAILABLE
                other_table.save(update_fields=["status"])
        return self

    def charge_to_room(self, guest_stay):
        """Charge-to-room path: posts this order's unbilled items onto the
        guest's open Folio as FolioLines instead of creating an Invoice
        (items already billed via a split — see bill() — are excluded, so
        splitting part of a check and charging the rest to a room doesn't
        double-charge). Settlement happens later at Folio.close()
        (checkout)."""
        from django.db import transaction

        from hotel.models import FolioLine

        with transaction.atomic():
            folio = guest_stay.folio
            items = self.unbilled_items().select_related("menu_item").prefetch_related(
                "modifiers"
            )
            for item in items:
                description, quantity, unit_price, tax_amount = self._describe_item(item)
                amount = quantity * unit_price
                FolioLine.objects.create(
                    organization=self.organization,
                    folio=folio,
                    line_type=FolioLine.LineType.RESTAURANT_CHARGE,
                    description=description,
                    quantity=quantity,
                    unit_price=unit_price,
                    amount=amount,
                    tax_amount=tax_amount,
                    source_order=self,
                )
            self.guest_stay = guest_stay
            self.status = self.Status.CHARGED_TO_ROOM
            self.save(update_fields=["guest_stay", "status"])
        return folio


class OrderItem(BaseTenantModel):
    class Status(models.TextChoices):
        NEW = "NEW", "New"
        COOKING = "COOKING", "Cooking"
        READY = "READY", "Ready"
        SERVED = "SERVED", "Served"
        CANCELLED = "CANCELLED", "Cancelled"

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    menu_item = models.ForeignKey("catalog.MenuItem", on_delete=models.PROTECT)
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=1)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    notes = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.NEW)
    kitchen_station = models.CharField(max_length=80, blank=True, default="Kitchen")
    # Set once this item has been attached to an Invoice via Order.bill();
    # null means "still unbilled" — see Order.unbilled_items(), the basis
    # for split billing.
    invoice = models.ForeignKey(
        "billing.Invoice",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="order_items",
    )

    def __str__(self):
        return f"{self.menu_item.name} x{self.quantity}"


class OrderItemModifier(BaseTenantModel):
    order_item = models.ForeignKey(
        OrderItem, on_delete=models.CASCADE, related_name="modifiers"
    )
    modifier = models.ForeignKey("catalog.Modifier", on_delete=models.PROTECT)
    price_delta = models.DecimalField(max_digits=10, decimal_places=2, default=0)


class KitchenTicket(BaseTenantModel):
    class Status(models.TextChoices):
        NEW = "NEW", "New"
        COOKING = "COOKING", "Cooking"
        READY = "READY", "Ready"
        SERVED = "SERVED", "Served"

    store = models.ForeignKey(
        "organizations.Store", on_delete=models.CASCADE, related_name="kitchen_tickets"
    )
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="kitchen_tickets")
    kitchen_station = models.CharField(max_length=80)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.NEW)

    def refresh_status(self):
        """Status is derived from its items' min status — not editable
        directly, to avoid two sources of truth. Order: NEW < COOKING <
        READY < SERVED. Cancelled items are excluded from that ranking —
        they're not in this list at all, so one cancelled item can't hold
        the whole ticket at NEW while its other items are actually READY —
        and if every item on the ticket ends up cancelled, it's treated as
        done rather than stuck with no status to derive."""
        order_rank = [self.Status.NEW, self.Status.COOKING, self.Status.READY, self.Status.SERVED]
        item_statuses = list(
            self.ticket_items.exclude(order_item__status="CANCELLED").values_list(
                "order_item__status", flat=True
            )
        )
        if not item_statuses:
            if self.ticket_items.exists():
                self.status = self.Status.SERVED
                self.save(update_fields=["status"])
            return
        ranks = [order_rank.index(s) for s in item_statuses]
        self.status = order_rank[min(ranks)]
        self.save(update_fields=["status"])


class KitchenTicketItem(BaseTenantModel):
    kitchen_ticket = models.ForeignKey(
        KitchenTicket, on_delete=models.CASCADE, related_name="ticket_items"
    )
    order_item = models.ForeignKey(OrderItem, on_delete=models.CASCADE)
