from rest_framework import serializers

from catalog.models import MenuCategory, MenuItem, Modifier, ModifierGroup, TaxClass


class TaxClassSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaxClass
        fields = ["id", "name", "rate_percent", "is_inclusive"]
        read_only_fields = ["id"]


class MenuCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = MenuCategory
        fields = ["id", "store", "name", "sort_order"]
        read_only_fields = ["id"]


class ModifierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Modifier
        fields = ["id", "modifier_group", "name", "price_delta"]
        read_only_fields = ["id"]


class ModifierGroupSerializer(serializers.ModelSerializer):
    modifiers = ModifierSerializer(many=True, read_only=True)

    class Meta:
        model = ModifierGroup
        fields = [
            "id", "store", "name", "selection_type", "min_select", "max_select",
            "is_required", "modifiers",
        ]
        read_only_fields = ["id"]


class MenuItemSerializer(serializers.ModelSerializer):
    modifier_groups = serializers.SerializerMethodField()

    class Meta:
        model = MenuItem
        fields = [
            "id", "store", "category", "name", "price", "tax_class",
            "kitchen_station", "is_active", "image", "modifier_groups",
        ]
        read_only_fields = ["id"]

    def get_modifier_groups(self, obj):
        # Each group's modifier LIST here is this item's own selection —
        # from MenuItemModifier overrides, not the group's full org-wide
        # option list — so a modifier the item owner hasn't enabled (or
        # has priced) for this item simply doesn't appear as orderable on
        # it, even though the group itself may offer more options on other
        # items. See MenuItemModifier's docstring for why.
        links = obj.modifier_group_links.select_related("modifier_group").order_by("sort_order")
        overrides_by_group = {}
        for override in obj.item_modifiers.select_related("modifier"):
            overrides_by_group.setdefault(override.modifier.modifier_group_id, []).append(override)

        return [
            {
                "id": str(link.modifier_group.id),
                "store": str(link.modifier_group.store_id),
                "name": link.modifier_group.name,
                "selection_type": link.modifier_group.selection_type,
                "min_select": link.modifier_group.min_select,
                "max_select": link.modifier_group.max_select,
                "is_required": link.modifier_group.is_required,
                "modifiers": [
                    {
                        "id": str(o.modifier_id),
                        "modifier_group": str(link.modifier_group.id),
                        "name": o.modifier.name,
                        "price_delta": str(o.price_delta),
                    }
                    for o in overrides_by_group.get(link.modifier_group_id, [])
                ],
            }
            for link in links
        ]
