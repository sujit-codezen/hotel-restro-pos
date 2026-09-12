from rest_framework import serializers

from orders.models import KitchenTicket, KitchenTicketItem, Order, OrderItem, OrderItemModifier


class OrderItemModifierSerializer(serializers.ModelSerializer):
    modifier_name = serializers.CharField(source="modifier.name", read_only=True)
    modifier_group_name = serializers.CharField(source="modifier.modifier_group.name", read_only=True)

    class Meta:
        model = OrderItemModifier
        fields = ["id", "modifier", "modifier_name", "modifier_group_name", "price_delta"]
        read_only_fields = ["id"]


class OrderItemModifierWriteSerializer(serializers.Serializer):
    modifier = serializers.UUIDField()


class OrderItemSerializer(serializers.ModelSerializer):
    modifiers = OrderItemModifierSerializer(many=True, read_only=True)
    menu_item_name = serializers.CharField(source="menu_item.name", read_only=True)
    # Ticketed items are locked here (OrderViewSet.edit_item) — cancel them
    # from the Kitchen screen instead — so the cart UI needs to tell a
    # freshly-added, still-editable item apart from one already sent,
    # regardless of what the *order's* overall status is.
    sent_to_kitchen = serializers.SerializerMethodField()

    class Meta:
        model = OrderItem
        fields = [
            "id", "menu_item", "menu_item_name", "quantity", "unit_price", "notes", "status",
            "kitchen_station", "modifiers", "invoice", "sent_to_kitchen",
        ]
        read_only_fields = ["id", "status", "invoice"]

    def get_sent_to_kitchen(self, obj):
        # len(...all()) instead of .exists() so this respects the
        # "items__kitchenticketitem_set" prefetch on OrderViewSet's
        # queryset — .exists() would issue its own query per item instead.
        return len(obj.kitchenticketitem_set.all()) > 0


class OrderItemCreateSerializer(serializers.Serializer):
    menu_item = serializers.UUIDField()
    quantity = serializers.DecimalField(max_digits=10, decimal_places=2, default=1)
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    modifiers = serializers.ListField(child=serializers.UUIDField(), required=False, default=list)


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)

    class Meta:
        model = Order
        fields = [
            "id", "store", "order_type", "table", "customer", "guest_stay",
            "status", "created_by", "created_at", "items",
        ]
        read_only_fields = ["id", "status", "created_at"]


class ChargeToRoomSerializer(serializers.Serializer):
    guest_stay_id = serializers.UUIDField()


class BillSerializer(serializers.Serializer):
    # Omitted/empty -> bill every unbilled item (the plain, non-split path).
    item_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list
    )


class MergeOrderSerializer(serializers.Serializer):
    other_order_id = serializers.UUIDField()


class KitchenTicketItemSerializer(serializers.ModelSerializer):
    order_item = OrderItemSerializer(read_only=True)

    class Meta:
        model = KitchenTicketItem
        fields = ["id", "order_item"]


class KitchenTicketSerializer(serializers.ModelSerializer):
    ticket_items = KitchenTicketItemSerializer(many=True, read_only=True)
    order_type = serializers.CharField(source="order.order_type", read_only=True)
    # A SerializerMethodField, not source="order.table.name" — table is
    # nullable (takeaway/delivery orders), and a plain `source` chain
    # would raise trying to read .name off None instead of just being null.
    table_name = serializers.SerializerMethodField()

    class Meta:
        model = KitchenTicket
        fields = [
            "id", "order", "order_type", "table_name", "kitchen_station", "status",
            "created_at", "ticket_items",
        ]

    def get_table_name(self, obj):
        return obj.order.table.name if obj.order.table_id else None
