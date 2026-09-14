from decimal import Decimal

from rest_framework import serializers
from rest_framework.validators import UniqueTogetherValidator

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


class RoomTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoomType
        fields = ["id", "store", "name", "base_rate", "capacity"]
        read_only_fields = ["id"]
        validators = [
            UniqueTogetherValidator(
                queryset=RoomType.objects.all(),
                fields=["store", "name"],
                message="A room type with this name already exists at this store.",
            )
        ]


class RoomSerializer(serializers.ModelSerializer):
    room_type_name = serializers.CharField(source="room_type.name", read_only=True)

    class Meta:
        model = Room
        fields = ["id", "store", "room_type", "room_type_name", "number", "floor", "status"]
        read_only_fields = ["id"]
        validators = [
            UniqueTogetherValidator(
                queryset=Room.objects.all(),
                fields=["store", "number"],
                message="A room with this number already exists at this store.",
            )
        ]


class ReservationFoodItemSerializer(serializers.ModelSerializer):
    menu_item_name = serializers.CharField(source="menu_item.name", read_only=True)

    class Meta:
        model = ReservationFoodItem
        fields = ["id", "menu_item", "menu_item_name", "quantity", "unit_price", "notes"]
        read_only_fields = ["id", "unit_price"]


class ReservationFoodItemCreateSerializer(serializers.Serializer):
    menu_item = serializers.UUIDField()
    quantity = serializers.DecimalField(max_digits=10, decimal_places=2, default=1, min_value=Decimal("0.01"))
    notes = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


# Changing the room/room type/dates only makes sense before the guest has
# actually arrived — once CHECKED_IN, the real occupancy lives on the
# GuestStay/Room, not the Reservation, so editing these here wouldn't move
# anything real. Same story once the reservation is done altogether
# (checked out/cancelled/no-show).
RESERVATION_ROOM_LOCKED_FIELDS = {"room", "room_type", "check_in_date", "check_out_date"}


class ReservationSerializer(serializers.ModelSerializer):
    guest_name = serializers.CharField(source="guest.name", read_only=True)
    guest_phone = serializers.CharField(source="guest.phone", read_only=True)
    room_type_name = serializers.CharField(source="room_type.name", read_only=True)
    room_number = serializers.SerializerMethodField()
    guest_stay_id = serializers.SerializerMethodField()
    food_items = ReservationFoodItemSerializer(many=True, read_only=True)

    class Meta:
        model = Reservation
        fields = [
            "id", "store", "guest", "guest_name", "guest_phone", "room_type",
            "room_type_name", "room", "room_number", "check_in_date",
            "check_out_date", "status", "adults", "children", "rate_per_night",
            "guest_stay_id", "food_items",
        ]
        read_only_fields = ["id", "status"]

    def get_room_number(self, obj):
        return obj.room.number if obj.room_id else None

    def get_guest_stay_id(self, obj):
        # Lets the frontend jump straight from a reservation to its folio
        # (order food to the room, take a deposit while IN_HOUSE; review the
        # final bill once CHECKED_OUT). Prefers the current occupancy if
        # there is one; a reservation can have more than one past GuestStay
        # (e.g. a previous cancelled/no-show cycle), so once nothing is
        # IN_HOUSE anymore this falls back to the most recent one instead of
        # leaving checked-out reservations with no folio to look back at.
        stays = list(obj.stays.all())
        stay = next((s for s in stays if s.status == GuestStay.Status.IN_HOUSE), None)
        if stay is None and stays:
            stay = max(stays, key=lambda s: s.check_in_at)
        return str(stay.id) if stay else None

    def validate(self, attrs):
        if (
            self.instance
            and self.instance.status != Reservation.Status.BOOKED
            and RESERVATION_ROOM_LOCKED_FIELDS & attrs.keys()
        ):
            raise serializers.ValidationError(
                "Only a booked reservation (before check-in) can have its room or dates changed."
            )

        room = attrs.get("room", getattr(self.instance, "room", None))
        check_in_date = attrs.get("check_in_date", getattr(self.instance, "check_in_date", None))
        check_out_date = attrs.get("check_out_date", getattr(self.instance, "check_out_date", None))
        if room and check_in_date and check_out_date:
            if check_out_date <= check_in_date:
                raise serializers.ValidationError(
                    {"check_out_date": "Check-out must be after check-in."}
                )
            exclude_id = self.instance.id if self.instance else None
            if not Reservation.room_is_available_for(room, check_in_date, check_out_date, exclude_id):
                raise serializers.ValidationError(
                    {"room": f"Room {room.number} is already booked for these dates."}
                )
        return attrs


class GuestStaySerializer(serializers.ModelSerializer):
    guest_name = serializers.CharField(source="guest.name", read_only=True)
    guest_phone = serializers.CharField(source="guest.phone", read_only=True)
    room_number = serializers.CharField(source="room.number", read_only=True)

    class Meta:
        model = GuestStay
        fields = [
            "id", "store", "reservation", "room", "room_number", "guest",
            "guest_name", "guest_phone", "check_in_at", "check_out_at", "status",
        ]
        read_only_fields = ["id", "check_in_at", "check_out_at", "status"]


class FolioLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = FolioLine
        fields = [
            "id", "line_type", "description", "quantity", "unit_price",
            "amount", "tax_amount", "source_order", "created_by", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class FolioLineCreateSerializer(serializers.Serializer):
    line_type = serializers.ChoiceField(choices=FolioLine.LineType.choices)
    description = serializers.CharField(max_length=255)
    quantity = serializers.DecimalField(max_digits=10, decimal_places=2, default=1)
    unit_price = serializers.DecimalField(max_digits=10, decimal_places=2)
    tax_amount = serializers.DecimalField(max_digits=10, decimal_places=2, default=0)


class FolioDepositSerializer(serializers.ModelSerializer):
    class Meta:
        model = FolioDeposit
        fields = ["id", "method", "amount", "reference_number", "received_by", "received_at"]
        read_only_fields = ["id", "received_by", "received_at"]


class FolioDepositCreateSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=FolioDeposit.Method.choices)
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0.01"))
    reference_number = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")


class FolioSerializer(serializers.ModelSerializer):
    lines = FolioLineSerializer(many=True, read_only=True)
    deposits = FolioDepositSerializer(many=True, read_only=True)
    total = serializers.SerializerMethodField()
    total_deposits = serializers.SerializerMethodField()
    balance_due = serializers.SerializerMethodField()

    class Meta:
        model = Folio
        fields = [
            "id", "store", "guest_stay", "status", "opened_at", "closed_at",
            "lines", "deposits", "total", "total_deposits", "balance_due",
        ]
        read_only_fields = ["id", "opened_at", "closed_at"]

    def get_total(self, obj):
        return obj.total()

    def get_total_deposits(self, obj):
        return obj.total_deposits()

    def get_balance_due(self, obj):
        return obj.total() - obj.total_deposits()
