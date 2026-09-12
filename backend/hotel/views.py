from django.db import transaction
from django.db.models import ProtectedError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from billing.serializers import InvoiceSerializer
from catalog.models import MenuItem
from core.mixins import OrgScopedViewSetMixin
from core.permissions import IsOrgMember
from hotel.models import (
    Folio,
    FolioDeposit,
    FolioLine,
    GuestStay,
    Reservation,
    ReservationFoodItem,
    Room,
    RoomType,
)
from hotel.serializers import (
    FolioDepositCreateSerializer,
    FolioLineCreateSerializer,
    FolioSerializer,
    GuestStaySerializer,
    ReservationFoodItemCreateSerializer,
    ReservationSerializer,
    RoomSerializer,
    RoomTypeSerializer,
)
from organizations.models import Store


class RoomTypeViewSet(OrgScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = RoomTypeSerializer
    permission_classes = [IsOrgMember]
    queryset = RoomType.objects.all()
    filterset_fields = ["store"]

    def perform_destroy(self, instance):
        # Room.room_type and Reservation.room_type are both PROTECT — a
        # type still in use anywhere (a room built from it, or a past/
        # future reservation naming it) refuses via a raw ProtectedError
        # otherwise, same pattern as RoleViewSet's still-assigned guard.
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError(
                "This room type still has rooms or reservations — reassign or remove those first."
            )


class RoomViewSet(OrgScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = RoomSerializer
    permission_classes = [IsOrgMember]
    queryset = Room.objects.all()
    filterset_fields = ["store", "status", "room_type"]

    def perform_destroy(self, instance):
        # GuestStay.room is PROTECT — a room with any stay on record
        # (current or historical) can't be deleted outright, to avoid
        # losing that audit trail out from under a real guest record.
        if instance.status == Room.Status.OCCUPIED:
            raise ValidationError("This room is currently occupied — check the guest out first.")
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError(
                "This room has guest stay history on record and can't be deleted."
            )

    @action(detail=False, methods=["get"], url_path="status-board")
    def status_board(self, request):
        store_id = request.query_params.get("store")
        qs = self.get_queryset()
        if store_id:
            qs = qs.filter(store_id=store_id)
        return Response(RoomSerializer(qs, many=True).data)


class ReservationViewSet(OrgScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = ReservationSerializer
    permission_classes = [IsOrgMember]
    queryset = Reservation.objects.select_related("guest", "room_type", "room").prefetch_related(
        "stays", "food_items__menu_item"
    ).order_by("-check_in_date")
    filterset_fields = ["store", "status", "guest"]

    def _restaurant_store_for(self, reservation):
        # Mirrors findRestaurantStoreFor() on the frontend: normally the
        # RESTAURANT-type store whose parent_store is this hotel property
        # (plan section 1's split setup), but some businesses run a single
        # combined store that's itself RESTAURANT-typed and also owns the
        # room/reservation directly (no separate hotel-property store) —
        # fall back to that same store so "pre-order food" still works for
        # a one-store restaurant-that-also-rents-rooms setup.
        child = Store.objects.filter(
            organization=reservation.organization,
            store_type=Store.StoreType.RESTAURANT,
            parent_store_id=reservation.store_id,
        ).first()
        if child:
            return child
        return Store.objects.filter(
            id=reservation.store_id, store_type=Store.StoreType.RESTAURANT
        ).first()

    @action(detail=True, methods=["post"], url_path="food-items")
    def add_food_item(self, request, pk=None):
        """Pre-orders a food item against a still-BOOKED reservation — the
        guest hasn't arrived yet, so there's no Folio to charge it to; it's
        copied onto the real folio as a RESTAURANT_CHARGE line at check-in
        (see check_in below). Once checked in, order through the room's
        folio/POS instead — that's real order history, not a pre-order."""
        reservation = self.get_object()
        if reservation.status != Reservation.Status.BOOKED:
            raise ValidationError("Food can only be pre-ordered before check-in.")
        restaurant_store = self._restaurant_store_for(reservation)
        if restaurant_store is None:
            raise ValidationError("This property has no linked restaurant to order from.")
        serializer = ReservationFoodItemCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        menu_item = get_object_or_404(
            MenuItem, id=data["menu_item"], organization=request.org, store=restaurant_store
        )
        ReservationFoodItem.objects.create(
            organization=request.org,
            reservation=reservation,
            menu_item=menu_item,
            quantity=data["quantity"],
            unit_price=menu_item.price,
            notes=data["notes"],
        )
        reservation = self.get_queryset().get(pk=reservation.pk)
        return Response(ReservationSerializer(reservation).data, status=201)

    @action(detail=True, methods=["delete"], url_path="food-items/(?P<item_id>[^/.]+)")
    def remove_food_item(self, request, pk=None, item_id=None):
        reservation = self.get_object()
        if reservation.status != Reservation.Status.BOOKED:
            raise ValidationError("Food can only be removed from a reservation before check-in.")
        item = get_object_or_404(ReservationFoodItem, reservation=reservation, id=item_id)
        item.delete()
        reservation = self.get_queryset().get(pk=reservation.pk)
        return Response(ReservationSerializer(reservation).data)

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        reservation = self.get_object()
        if reservation.status != Reservation.Status.BOOKED:
            return Response(
                {"detail": "Only a booked reservation that hasn't checked in yet can be cancelled."},
                status=400,
            )
        reservation.status = Reservation.Status.CANCELLED
        reservation.save(update_fields=["status"])
        return Response(ReservationSerializer(reservation).data)

    @action(detail=True, methods=["post"], url_path="check-in")
    def check_in(self, request, pk=None):
        reservation = self.get_object()
        room_id = request.data.get("room")
        room = (
            get_object_or_404(Room, id=room_id, organization=request.org)
            if room_id
            else reservation.room
        )
        if room is None:
            return Response({"detail": "A room must be assigned to check in."}, status=400)
        if room.status == Room.Status.OCCUPIED:
            return Response(
                {"detail": f"Room {room.number} is currently occupied by another guest."}, status=400
            )
        if not Reservation.room_is_available_for(
            room, reservation.check_in_date, reservation.check_out_date, exclude_id=reservation.id
        ):
            return Response(
                {"detail": f"Room {room.number} is already booked for these dates by another reservation."},
                status=400,
            )

        with transaction.atomic():
            reservation.room = room
            reservation.status = Reservation.Status.CHECKED_IN
            reservation.save(update_fields=["room", "status"])

            guest_stay = GuestStay.objects.create(
                organization=reservation.organization,
                store=reservation.store,
                reservation=reservation,
                room=room,
                guest=reservation.guest,
            )
            folio = Folio.objects.create(
                organization=reservation.organization,
                store=reservation.store,
                guest_stay=guest_stay,
            )
            nights = max((reservation.check_out_date - reservation.check_in_date).days, 1)
            FolioLine.objects.create(
                organization=reservation.organization,
                folio=folio,
                line_type=FolioLine.LineType.ROOM_CHARGE,
                description=f"Room {room.number} x {nights} night(s)",
                quantity=nights,
                unit_price=reservation.rate_per_night,
                amount=nights * reservation.rate_per_night,
            )
            # Anything pre-ordered while the reservation was still BOOKED
            # (see add_food_item) lands on the folio now, as real charges —
            # the pre-order rows themselves are left in place afterward as
            # a record of what was originally requested.
            for pre_order in reservation.food_items.select_related("menu_item"):
                FolioLine.objects.create(
                    organization=reservation.organization,
                    folio=folio,
                    line_type=FolioLine.LineType.RESTAURANT_CHARGE,
                    description=pre_order.menu_item.name,
                    quantity=pre_order.quantity,
                    unit_price=pre_order.unit_price,
                    amount=pre_order.quantity * pre_order.unit_price,
                )
            room.status = Room.Status.OCCUPIED
            room.save(update_fields=["status"])

        return Response(GuestStaySerializer(guest_stay).data, status=201)


class GuestStayViewSet(
    OrgScopedViewSetMixin,
    mixins.RetrieveModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = GuestStaySerializer
    permission_classes = [IsOrgMember]
    queryset = GuestStay.objects.select_related("guest", "room")
    filterset_fields = ["store", "status", "guest"]

    @action(detail=True, methods=["post"], url_path="check-out")
    def check_out(self, request, pk=None):
        guest_stay = self.get_object()
        folio = guest_stay.folio
        if folio.status != Folio.Status.OPEN:
            return Response({"detail": "Folio already closed."}, status=400)

        with transaction.atomic():
            invoice = folio.close()
            guest_stay.status = GuestStay.Status.CHECKED_OUT
            guest_stay.check_out_at = timezone.now()
            guest_stay.save(update_fields=["status", "check_out_at"])
            guest_stay.room.status = Room.Status.DIRTY
            guest_stay.room.save(update_fields=["status"])
            # Without this the reservation stays stuck at CHECKED_IN
            # forever, which not only reads wrong on the Reservations
            # screen but also puts it in the Active tab (and would block
            # any future booking of the same room from this reservation's
            # own overlap check) even though the stay is long over.
            if guest_stay.reservation_id:
                Reservation.objects.filter(id=guest_stay.reservation_id).update(
                    status=Reservation.Status.CHECKED_OUT
                )

        return Response(InvoiceSerializer(invoice).data, status=201)


class FolioViewSet(
    OrgScopedViewSetMixin,
    mixins.RetrieveModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = FolioSerializer
    permission_classes = [IsOrgMember]
    queryset = Folio.objects.prefetch_related("lines", "deposits").order_by("-opened_at")
    # Without this, GET /folios/?guest_stay=<id> silently ignores the
    # query param (no FilterSet configured means DRF's filter backend has
    # nothing to filter on) and returns every folio in the org — the
    # frontend folio page takes results[0], so whichever folio happened to
    # sort first would show up instead of the one actually requested.
    filterset_fields = ["store", "guest_stay", "status"]

    @action(detail=True, methods=["post"], url_path="deposits")
    def add_deposit(self, request, pk=None):
        """Records an advance/deposit payment taken mid-stay — see
        FolioDeposit's docstring for why this isn't just a billing.Payment
        (there's no Invoice yet; one only exists once the folio closes)."""
        folio = self.get_object()
        if folio.status != Folio.Status.OPEN:
            raise ValidationError("This folio is already closed.")
        serializer = FolioDepositCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        FolioDeposit.objects.create(
            organization=folio.organization,
            folio=folio,
            method=data["method"],
            amount=data["amount"],
            reference_number=data["reference_number"],
            received_by=request.user.store_assignments.filter(
                store=folio.store, is_active=True
            ).first(),
        )
        folio = self.get_queryset().get(pk=folio.pk)
        return Response(FolioSerializer(folio).data, status=201)

    @action(detail=True, methods=["post"], url_path="lines")
    def add_line(self, request, pk=None):
        folio = self.get_object()
        serializer = FolioLineCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        FolioLine.objects.create(
            organization=folio.organization,
            folio=folio,
            line_type=data["line_type"],
            description=data["description"],
            quantity=data["quantity"],
            unit_price=data["unit_price"],
            amount=data["quantity"] * data["unit_price"],
            tax_amount=data["tax_amount"],
            created_by=request.user.store_assignments.filter(
                store=folio.store, is_active=True
            ).first(),
        )
        # folio.lines was prefetched by get_object() before this line
        # existed; re-fetch so the response includes it (same staleness
        # class as the Order.items fix in orders/views.py).
        folio = self.get_queryset().get(pk=folio.pk)
        return Response(FolioSerializer(folio).data, status=201)

    @action(detail=True, methods=["post"], url_path="close")
    def close(self, request, pk=None):
        folio = self.get_object()
        invoice = folio.close()
        return Response(InvoiceSerializer(invoice).data, status=201)
