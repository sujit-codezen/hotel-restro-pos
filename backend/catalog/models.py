from django.db import models

from core.models import BaseTenantModel


class MenuCategory(BaseTenantModel):
    store = models.ForeignKey(
        "organizations.Store", on_delete=models.CASCADE, related_name="menu_categories"
    )
    name = models.CharField(max_length=120)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "name"]
        verbose_name_plural = "menu categories"

    def __str__(self):
        return self.name


class TaxClass(BaseTenantModel):
    name = models.CharField(max_length=80)
    rate_percent = models.DecimalField(max_digits=5, decimal_places=2)
    is_inclusive = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.name} ({self.rate_percent}%)"


class MenuItem(BaseTenantModel):
    store = models.ForeignKey(
        "organizations.Store", on_delete=models.CASCADE, related_name="menu_items"
    )
    category = models.ForeignKey(
        MenuCategory, on_delete=models.SET_NULL, null=True, related_name="items"
    )
    name = models.CharField(max_length=160)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    tax_class = models.ForeignKey(
        TaxClass, on_delete=models.SET_NULL, null=True, blank=True
    )
    kitchen_station = models.CharField(max_length=80, blank=True, default="Kitchen")
    is_active = models.BooleanField(default=True)
    image = models.ImageField(upload_to="menu_items/", null=True, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class ModifierGroup(BaseTenantModel):
    class SelectionType(models.TextChoices):
        SINGLE = "SINGLE", "Single choice"
        MULTIPLE = "MULTIPLE", "Multiple choice"

    store = models.ForeignKey(
        "organizations.Store", on_delete=models.CASCADE, related_name="modifier_groups"
    )
    name = models.CharField(max_length=120)
    selection_type = models.CharField(max_length=10, choices=SelectionType.choices)
    min_select = models.PositiveIntegerField(default=0)
    max_select = models.PositiveIntegerField(default=1)
    is_required = models.BooleanField(default=False)

    def __str__(self):
        return self.name


class Modifier(BaseTenantModel):
    modifier_group = models.ForeignKey(
        ModifierGroup, on_delete=models.CASCADE, related_name="modifiers"
    )
    name = models.CharField(max_length=120)
    price_delta = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    def __str__(self):
        return f"{self.name} ({self.price_delta:+})"


class MenuItemModifierGroup(BaseTenantModel):
    menu_item = models.ForeignKey(
        MenuItem, on_delete=models.CASCADE, related_name="modifier_group_links"
    )
    modifier_group = models.ForeignKey(ModifierGroup, on_delete=models.CASCADE)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order"]
        unique_together = ("menu_item", "modifier_group")


class MenuItemModifier(BaseTenantModel):
    """Which of a group's options are actually offered on *this* item, and
    at what price *for this item* — Modifier.price_delta is only a
    starting default (copied here the moment a group is attached); once a
    row exists here it's the authoritative price for that (item, modifier)
    pair, since the same "Large" option can reasonably cost a different
    amount on a pizza than it does on a momo. No row for a given modifier
    means that option isn't offered on this item, even if its group is
    attached and offers it elsewhere."""

    menu_item = models.ForeignKey(MenuItem, on_delete=models.CASCADE, related_name="item_modifiers")
    modifier = models.ForeignKey(Modifier, on_delete=models.CASCADE, related_name="item_overrides")
    price_delta = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    class Meta:
        unique_together = ("menu_item", "modifier")

    def __str__(self):
        return f"{self.menu_item.name} · {self.modifier.name} ({self.price_delta:+})"
