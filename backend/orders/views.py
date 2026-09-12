import django_filters
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from billing.serializers import InvoiceSerializer
from catalog.models import MenuItem, MenuItemModifier, Modifier
from core.mixins import OrgScopedViewSetMixin
from core.permissions import IsOrgMember
from hotel.models import GuestStay
from hotel.serializers import FolioSerializer
from orders.models import KitchenTicket, KitchenTicketItem, Order, OrderItem, OrderItemModifier
from orders.serializers import (
    BillSerializer,
    ChargeToRoomSerializer,
    KitchenTicketSerializer,
    MergeOrderSerializer,
    OrderItemCreateSerializer,
    OrderSerializer,
)
from realtime.services import broadcast_ticket_update


SETTLED_STATUSES = (Order.Status.BILLED, Order.Status.CHARGED_TO_ROOM, Order.Status.CANCELLED)


class OrderViewSet(OrgScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = OrderSerializer
    permission_classes = [IsOrgMember]
    queryset = Order.objects.prefetch_related(
        "items__menu_item", "items__modifiers__modifier__modifier_group", "items__kitchenticketitem_set"
    )
    filterset_fields = ["store", "status", "order_type", "table", "customer", "guest_stay"]

    @action(detail=True, methods=["post"], url_path="items")
    def add_item(self, request, pk=None):
        # A table ordering a second round after the first has already gone
        # to the kitchen is completely normal — only a settled order (paid,
        # charged to room, or cancelled) refuses new items. Sending the new
        # ones to the kitchen is a separate, later "Send to kitchen" call.
        order = self.get_object()
        if order.status in SETTLED_STATUSES:
            raise ValidationError("This order is already settled — start a new order instead.")
        serializer = OrderItemCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        menu_item = get_object_or_404(
            MenuItem, id=data["menu_item"], organization=request.org
        )
        with transaction.atomic():
            order_item = OrderItem.objects.create(
                organization=request.org,
                order=order,
                menu_item=menu_item,
                quantity=data["quantity"],
                unit_price=menu_item.price,
                notes=data["notes"],
                kitchen_station=menu_item.kitchen_station,
            )
            for modifier_id in data["modifiers"]:
                modifier = get_object_or_404(
                    Modifier, id=modifier_id, organization=request.org
                )
                # The price for this (item, modifier) pair — "Large" can
                # cost something different on a pizza than on a momo — is
                # the item's own override if it's set one; only a modifier
                # that was never given a per-item price (or attached
                # through some other path) falls back to its own default.
                override = MenuItemModifier.objects.filter(
                    menu_item=menu_item, modifier=modifier
                ).first()
                OrderItemModifier.objects.create(
                    organization=request.org,
                    order_item=order_item,
                    modifier=modifier,
                    price_delta=override.price_delta if override else modifier.price_delta,
                )
        # order.items was prefetched by get_object() before this item
        # existed; re-fetch so the response doesn't show a stale empty list.
        order = self.get_queryset().get(pk=order.pk)
        return Response(OrderSerializer(order).data, status=201)

    @action(detail=True, methods=["patch", "delete"], url_path="items/(?P<item_id>[^/.]+)")
    def edit_item(self, request, pk=None, item_id=None):
        """Adjust quantity or remove a cart line before it's gone anywhere.
        Gated per-item, not per-order: a round-2 item added after the order
        already went to the kitchen is still perfectly editable/removable
        right up until *that item* itself gets sent — this used to check
        the whole order's status, which blocked editing a brand new item
        just because some earlier item had already shipped to the kitchen.
        Once an item has its own KitchenTicketItem, this refuses — cancel
        it from the Kitchen screen instead (KitchenTicketViewSet.cancel_item)."""
        order = self.get_object()
        item = get_object_or_404(OrderItem, id=item_id, order=order)

        if item.invoice_id:
            raise ValidationError("This item has already been billed and can't be changed.")
        if KitchenTicketItem.objects.filter(order_item=item).exists():
            raise ValidationError(
                "This item has already been sent to the kitchen — cancel it from the Kitchen screen instead."
            )

        if request.method == "DELETE":
            item.delete()
            order = self.get_queryset().get(pk=order.pk)
            return Response(OrderSerializer(order).data)

        quantity = request.data.get("quantity")
        try:
            quantity = int(quantity)
        except (TypeError, ValueError):
            raise ValidationError({"quantity": "Must be a positive integer."})
        if quantity < 1:
            raise ValidationError({"quantity": "Must be at least 1."})
        item.quantity = quantity
        item.save(update_fields=["quantity"])
        order = self.get_queryset().get(pk=order.pk)
        return Response(OrderSerializer(order).data)

    @action(detail=True, methods=["post"], url_path="send-to-kitchen")
    def send_to_kitchen(self, request, pk=None):
        """Tickets whatever hasn't been ticketed yet — safe to call more
        than once on the same order (a second round ordered after the
        first already went to the kitchen), since it only ever picks up
        items with no KitchenTicketItem yet. Each call that finds anything
        new fires its own fresh ticket(s), same as the very first send."""
        order = self.get_object()
        if order.status in SETTLED_STATUSES:
            raise ValidationError("This order is already settled.")

        with transaction.atomic():
            new_items = list(order.items.filter(kitchenticketitem__isnull=True))
            if not new_items:
                raise ValidationError("No new items to send to the kitchen.")

            items_by_station = {}
            for item in new_items:
                items_by_station.setdefault(item.kitchen_station, []).append(item)

            for station, items in items_by_station.items():
                ticket = KitchenTicket.objects.create(
                    organization=order.organization,
                    store=order.store,
                    order=order,
                    kitchen_station=station,
                )
                for item in items:
                    KitchenTicketItem.objects.create(
                        organization=order.organization,
                        kitchen_ticket=ticket,
                        order_item=item,
                    )
                broadcast_ticket_update(order.store_id, ticket)

            order.status = Order.Status.SENT_TO_KITCHEN
            order.save(update_fields=["status"])
        order = self.get_queryset().get(pk=order.pk)
        return Response(OrderSerializer(order).data)

    @action(detail=True, methods=["post"], url_path="hold")
    def hold(self, request, pk=None):
        order = self.get_object()
        order.status = Order.Status.HELD
        order.save(update_fields=["status"])
        return Response(OrderSerializer(order).data)

    @action(detail=True, methods=["post"], url_path="resume")
    def resume(self, request, pk=None):
        order = self.get_object()
        order.status = Order.Status.OPEN
        order.save(update_fields=["status"])
        return Response(OrderSerializer(order).data)

    @action(detail=True, methods=["post"], url_path="bill")
    def bill(self, request, pk=None):
        order = self.get_object()
        serializer = BillSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item_ids = serializer.validated_data["item_ids"] or None
        try:
            invoice = order.bill(item_ids=item_ids)
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages)
        return Response(InvoiceSerializer(invoice).data, status=201)

    @action(detail=True, methods=["post"], url_path="merge")
    def merge(self, request, pk=None):
        order = self.get_object()
        serializer = MergeOrderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        other_order = get_object_or_404(
            self.get_queryset(), id=serializer.validated_data["other_order_id"]
        )
        try:
            order.merge_from(other_order)
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages)
        # order.items was prefetched by get_object() before the merge moved
        # other_order's items onto it; re-fetch for a response that
        # actually shows the merged item list.
        order = self.get_queryset().get(pk=order.pk)
        return Response(OrderSerializer(order).data)

    @action(detail=True, methods=["post"], url_path="charge-to-room")
    def charge_to_room(self, request, pk=None):
        order = self.get_object()
        serializer = ChargeToRoomSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        guest_stay = get_object_or_404(
            GuestStay, id=serializer.validated_data["guest_stay_id"], organization=request.org
        )
        folio = order.charge_to_room(guest_stay)
        return Response(FolioSerializer(folio).data, status=201)


class KitchenTicketFilter(django_filters.FilterSet):
    # Calendar-day match on created_at, in the server's local timezone —
    # e.g. ?date=2026-09-10 — for browsing a previous day's tickets on the
    # KDS "Done" tab. Left off entirely, filtering is unchanged (every
    # ticket, oldest default DjangoFilterBackend behavior); the frontend
    # is what always supplies one when it wants a specific day.
    date = django_filters.DateFilter(field_name="created_at", lookup_expr="date")
    date_from = django_filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="created_at", lookup_expr="date__lte")

    class Meta:
        model = KitchenTicket
        fields = ["store", "kitchen_station", "status", "date", "date_from", "date_to"]


class KitchenTicketViewSet(OrgScopedViewSetMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = KitchenTicketSerializer
    permission_classes = [IsOrgMember]
    queryset = KitchenTicket.objects.select_related("order__table").prefetch_related(
        "ticket_items__order_item__menu_item",
        "ticket_items__order_item__modifiers__modifier__modifier_group",
    ).order_by("-created_at")
    filterset_class = KitchenTicketFilter

    @action(detail=True, methods=["patch"], url_path="items/(?P<item_id>[^/.]+)/status")
    def set_item_status(self, request, pk=None, item_id=None):
        ticket = self.get_object()
        status_value = request.data.get("status")
        # CANCELLED has its own action below with its own guards (already
        # billed, already too far along) — not a plain forward/back move.
        if status_value not in OrderItem.Status.values or status_value == OrderItem.Status.CANCELLED:
            return Response({"detail": "Invalid status."}, status=400)

        ticket_item = get_object_or_404(
            KitchenTicketItem, kitchen_ticket=ticket, order_item_id=item_id
        )
        order_item = ticket_item.order_item
        order_item.status = status_value
        order_item.save(update_fields=["status"])

        ticket.refresh_status()
        broadcast_ticket_update(ticket.store_id, ticket)
        # ticket.ticket_items__order_item was prefetched by get_object()
        # before order_item.status changed above; re-fetch so the response
        # reflects it (same staleness class as the Order.items fix).
        ticket = self.get_queryset().get(pk=ticket.pk)
        return Response(KitchenTicketSerializer(ticket).data)

    @action(detail=True, methods=["post"], url_path="items/(?P<item_id>[^/.]+)/cancel")
    def cancel_item(self, request, pk=None, item_id=None):
        """Cancels a single item on an already-sent ticket — the one thing
        edit_item (Order.items/{id}, DELETE) explicitly can't do once the
        order has left OPEN/HELD. Blocked once the item is billed (money
        already tied to it) or already READY/SERVED (kitchen's done with
        it — too late to un-cook it)."""
        ticket = self.get_object()
        ticket_item = get_object_or_404(
            KitchenTicketItem, kitchen_ticket=ticket, order_item_id=item_id
        )
        order_item = ticket_item.order_item

        if order_item.invoice_id:
            raise ValidationError("This item has already been billed and can't be cancelled.")
        if order_item.status in (OrderItem.Status.READY, OrderItem.Status.SERVED):
            raise ValidationError(
                f"This item is already {order_item.status.lower()} and can't be cancelled."
            )
        if order_item.status == OrderItem.Status.CANCELLED:
            raise ValidationError("This item is already cancelled.")

        order_item.status = OrderItem.Status.CANCELLED
        order_item.save(update_fields=["status"])

        ticket.refresh_status()
        broadcast_ticket_update(ticket.store_id, ticket)
        ticket = self.get_queryset().get(pk=ticket.pk)
        return Response(KitchenTicketSerializer(ticket).data)
