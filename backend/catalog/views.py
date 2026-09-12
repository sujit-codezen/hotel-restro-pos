from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Max, ProtectedError
from django.shortcuts import get_object_or_404
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from catalog.models import (
    MenuCategory,
    MenuItem,
    MenuItemModifier,
    MenuItemModifierGroup,
    Modifier,
    ModifierGroup,
    TaxClass,
)
from catalog.serializers import (
    MenuCategorySerializer,
    MenuItemSerializer,
    ModifierGroupSerializer,
    ModifierSerializer,
    TaxClassSerializer,
)
from core.mixins import OrgScopedViewSetMixin, RequiresPermissionMixin
from core.permissions import IsOrgMember, require_permission


class MenuCategoryViewSet(RequiresPermissionMixin, OrgScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = MenuCategorySerializer
    permission_classes = [IsOrgMember]
    queryset = MenuCategory.objects.all()
    filterset_fields = ["store"]
    required_permission = "can_manage_menu"
    # MenuItem.category is SET_NULL, so deleting a category just uncategorizes
    # its items — no ProtectedError guard needed here.


class MenuItemViewSet(RequiresPermissionMixin, OrgScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = MenuItemSerializer
    permission_classes = [IsOrgMember]
    queryset = MenuItem.objects.select_related("category", "tax_class")
    filterset_fields = ["store", "category", "is_active"]
    required_permission = "can_manage_menu"

    def perform_destroy(self, instance):
        require_permission(self.request, self.required_permission, store=instance.store)
        # OrderItem.menu_item is PROTECT — an item that's ever been ordered
        # can't be hard-deleted. Deactivating (is_active=False) is the
        # intended way to retire it instead.
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError(
                "This item has order history and can't be deleted — deactivate it instead."
            )

    @action(detail=True, methods=["post"], url_path="modifier-groups")
    def add_modifier_group(self, request, pk=None):
        """Attaches a reusable ModifierGroup (e.g. "Toppings", "Size") to
        this item — this is how a group actually becomes a topping/variant
        picker on a specific dish, rather than just existing in the
        Modifier Groups library unattached to anything."""
        item = self.get_object()
        require_permission(request, self.required_permission, store=item.store)
        group = get_object_or_404(
            ModifierGroup, id=request.data.get("modifier_group"), organization=request.org
        )
        if MenuItemModifierGroup.objects.filter(menu_item=item, modifier_group=group).exists():
            raise ValidationError("This group is already attached to this item.")
        next_sort_order = (
            item.modifier_group_links.aggregate(m=Max("sort_order"))["m"]
        )
        with transaction.atomic():
            MenuItemModifierGroup.objects.create(
                organization=request.org,
                menu_item=item,
                modifier_group=group,
                sort_order=0 if next_sort_order is None else next_sort_order + 1,
            )
            # Start every option in the group available on this item, at
            # the group's own default price, so the picker isn't empty
            # right after attaching — the item owner can then uncheck
            # options that don't apply here and/or reprice per option via
            # set_item_modifier/unset_item_modifier below.
            MenuItemModifier.objects.bulk_create(
                [
                    MenuItemModifier(organization=request.org, menu_item=item, modifier=m, price_delta=m.price_delta)
                    for m in group.modifiers.all()
                ],
                ignore_conflicts=True,
            )
        item = self.get_queryset().get(pk=item.pk)
        return Response(MenuItemSerializer(item).data, status=201)

    @action(detail=True, methods=["delete"], url_path="modifier-groups/(?P<group_id>[^/.]+)")
    def remove_modifier_group(self, request, pk=None, group_id=None):
        item = self.get_object()
        require_permission(request, self.required_permission, store=item.store)
        link = get_object_or_404(MenuItemModifierGroup, menu_item=item, modifier_group_id=group_id)
        with transaction.atomic():
            MenuItemModifier.objects.filter(menu_item=item, modifier__modifier_group_id=group_id).delete()
            link.delete()
        item = self.get_queryset().get(pk=item.pk)
        return Response(MenuItemSerializer(item).data)

    @action(detail=True, methods=["post"], url_path="item-modifiers")
    def set_item_modifier(self, request, pk=None):
        """(Re)selects one option as available on this item, at a price
        specific to this item — e.g. "Large" can cost something different
        on a pizza than it does on a momo, and a dish doesn't have to offer
        every option its group defines. This is the actual "which sizes
        are available, and what do they cost here" step; a plain group
        attach only seeds these at the group's default (see
        add_modifier_group)."""
        item = self.get_object()
        require_permission(request, self.required_permission, store=item.store)
        modifier = get_object_or_404(Modifier, id=request.data.get("modifier"), organization=request.org)
        if not MenuItemModifierGroup.objects.filter(
            menu_item=item, modifier_group_id=modifier.modifier_group_id
        ).exists():
            raise ValidationError("Attach this option's group to the item first.")
        try:
            price_delta = Decimal(str(request.data.get("price_delta", "")))
        except InvalidOperation:
            raise ValidationError({"price_delta": "Must be a number."})
        MenuItemModifier.objects.update_or_create(
            menu_item=item, modifier=modifier,
            defaults={"organization": request.org, "price_delta": price_delta},
        )
        item = self.get_queryset().get(pk=item.pk)
        return Response(MenuItemSerializer(item).data, status=201)

    @action(detail=True, methods=["delete"], url_path="item-modifiers/(?P<modifier_id>[^/.]+)")
    def unset_item_modifier(self, request, pk=None, modifier_id=None):
        """Marks one option as not offered on this item — the group can
        stay attached and keep offering its other options."""
        item = self.get_object()
        require_permission(request, self.required_permission, store=item.store)
        link = get_object_or_404(MenuItemModifier, menu_item=item, modifier_id=modifier_id)
        link.delete()
        item = self.get_queryset().get(pk=item.pk)
        return Response(MenuItemSerializer(item).data)


class ModifierGroupViewSet(RequiresPermissionMixin, OrgScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = ModifierGroupSerializer
    permission_classes = [IsOrgMember]
    queryset = ModifierGroup.objects.prefetch_related("modifiers")
    filterset_fields = ["store"]
    required_permission = "can_manage_menu"

    def perform_destroy(self, instance):
        require_permission(self.request, self.required_permission, store=instance.store)
        # Deleting a group cascades to its Modifiers, and OrderItemModifier.
        # modifier is PROTECT — a group with any modifier that's ever been
        # ordered can't be deleted as a whole.
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError(
                "One or more modifiers in this group have order history — remove the group's "
                "items from future orders first, or leave it in place."
            )


class ModifierViewSet(RequiresPermissionMixin, OrgScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = ModifierSerializer
    permission_classes = [IsOrgMember]
    queryset = Modifier.objects.all()
    filterset_fields = ["modifier_group"]
    # Modifier has no `store` of its own (only via modifier_group) — falls
    # back to RequiresPermissionMixin's org-wide check.
    required_permission = "can_manage_menu"

    def perform_destroy(self, instance):
        # Modifier has no `store` of its own — org-wide check, same as
        # RequiresPermissionMixin's default for this model.
        require_permission(self.request, self.required_permission, store=None)
        # OrderItemModifier.modifier is PROTECT — a modifier that's ever
        # been ordered can't be deleted.
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError("This modifier has been used in orders and can't be deleted.")


class TaxClassViewSet(RequiresPermissionMixin, OrgScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = TaxClassSerializer
    permission_classes = [IsOrgMember]
    queryset = TaxClass.objects.all()
    required_permission = "can_manage_menu"
