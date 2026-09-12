"""Dev/demo helper: seeds a store's menu with a realistic-sized catalog
(categories, 30+ items, a Size variant group and a Toppings group) so the
POS screen has enough to actually look and feel like a working menu.
Idempotent — get_or_create throughout, safe to re-run against the same
store without creating duplicates.

Not wired into onboarding or any other runtime path — this is a one-off
`manage.py seed_menu --store <uuid>` for local dev/demo data only.
"""

from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError

from catalog.models import MenuCategory, MenuItem, MenuItemModifierGroup, Modifier, ModifierGroup, TaxClass
from organizations.models import Store

SIZE_MODIFIERS = [("Small", "0"), ("Medium", "80"), ("Large", "150")]
TOPPING_MODIFIERS = [
    ("Extra Cheese", "100"),
    ("Mushroom", "60"),
    ("Olives", "50"),
    ("Jalapenos", "50"),
    ("Pepperoni", "120"),
    ("Onion", "40"),
    ("Bell Pepper", "40"),
]

# (category, item name, price, variants) — variants is a subset of
# {"size", "toppings"}: which of the two reusable modifier groups this
# item links to.
MENU = [
    ("Starters", "Chicken Momo", "280", set()),
    ("Starters", "Veg Momo", "220", set()),
    ("Starters", "Chicken Wings", "350", set()),
    ("Starters", "Spring Rolls", "240", set()),
    ("Starters", "Paneer Tikka", "320", set()),
    ("Starters", "Chilli Chicken", "380", set()),
    ("Main Course", "Chicken Biryani", "450", set()),
    ("Main Course", "Veg Biryani", "380", set()),
    ("Main Course", "Butter Chicken", "480", set()),
    ("Main Course", "Paneer Butter Masala", "400", set()),
    ("Main Course", "Dal Makhani", "300", set()),
    ("Main Course", "Chow Mein", "320", set()),
    ("Main Course", "Fried Rice", "300", set()),
    ("Pizza", "Chicken Pizza", "650", {"size", "toppings"}),
    ("Pizza", "Margherita Pizza", "550", {"size", "toppings"}),
    ("Pizza", "Pepperoni Pizza", "700", {"size", "toppings"}),
    ("Pizza", "Veg Supreme Pizza", "600", {"size", "toppings"}),
    ("Pizza", "BBQ Chicken Pizza", "720", {"size", "toppings"}),
    ("Pizza", "Farmhouse Pizza", "580", {"size", "toppings"}),
    ("Burgers", "Classic Beef Burger", "380", {"size", "toppings"}),
    ("Burgers", "Chicken Burger", "350", {"size", "toppings"}),
    ("Burgers", "Veg Burger", "280", {"size", "toppings"}),
    ("Burgers", "Cheese Burger", "400", {"size", "toppings"}),
    ("Burgers", "Spicy Chicken Burger", "380", {"size", "toppings"}),
    ("Beverages", "Coca Cola", "80", {"size"}),
    ("Beverages", "Fresh Lime Soda", "100", {"size"}),
    ("Beverages", "Mango Lassi", "150", {"size"}),
    ("Beverages", "Masala Tea", "60", {"size"}),
    ("Beverages", "Cold Coffee", "180", {"size"}),
    ("Beverages", "Mineral Water", "40", set()),
    ("Desserts", "Chocolate Brownie", "220", set()),
    ("Desserts", "Ice Cream Sundae", "200", set()),
    ("Desserts", "Gulab Jamun", "150", set()),
    ("Desserts", "Cheesecake", "250", set()),
    ("Desserts", "Fruit Salad", "180", set()),
]


class Command(BaseCommand):
    help = "Seeds a store's menu with categories, 30+ items, and Size/Toppings modifier groups."

    def add_arguments(self, parser):
        parser.add_argument("--store", required=True, help="Store UUID to seed the menu into.")

    def handle(self, *args, **options):
        try:
            store = Store.objects.get(id=options["store"])
        except Store.DoesNotExist as exc:
            raise CommandError(f"No store with id {options['store']}") from exc
        org = store.organization

        tax_class = TaxClass.objects.filter(organization=org).first()

        categories = {}
        for cat_name in dict.fromkeys(row[0] for row in MENU):
            categories[cat_name], _ = MenuCategory.objects.get_or_create(
                organization=org, store=store, name=cat_name
            )

        size_group, _ = ModifierGroup.objects.get_or_create(
            organization=org, store=store, name="Size",
            defaults={"selection_type": ModifierGroup.SelectionType.SINGLE, "min_select": 1, "max_select": 1, "is_required": True},
        )
        for name, delta in SIZE_MODIFIERS:
            Modifier.objects.get_or_create(
                organization=org, modifier_group=size_group, name=name,
                defaults={"price_delta": Decimal(delta)},
            )

        topping_group, _ = ModifierGroup.objects.get_or_create(
            organization=org, store=store, name="Toppings",
            defaults={"selection_type": ModifierGroup.SelectionType.MULTIPLE, "min_select": 0, "max_select": 5, "is_required": False},
        )
        for name, delta in TOPPING_MODIFIERS:
            Modifier.objects.get_or_create(
                organization=org, modifier_group=topping_group, name=name,
                defaults={"price_delta": Decimal(delta)},
            )

        created_items = 0
        for cat_name, item_name, price, variants in MENU:
            item, created = MenuItem.objects.get_or_create(
                organization=org, store=store, name=item_name,
                defaults={
                    "category": categories[cat_name],
                    "price": Decimal(price),
                    "tax_class": tax_class,
                },
            )
            if created:
                created_items += 1

            if "size" in variants:
                MenuItemModifierGroup.objects.get_or_create(
                    organization=org, menu_item=item, modifier_group=size_group,
                    defaults={"sort_order": 0},
                )
            if "toppings" in variants:
                MenuItemModifierGroup.objects.get_or_create(
                    organization=org, menu_item=item, modifier_group=topping_group,
                    defaults={"sort_order": 1},
                )

        self.stdout.write(self.style.SUCCESS(
            f"Seeded {store.name}: {len(categories)} categories, "
            f"{created_items} new menu items ({len(MENU)} total in the seed list), "
            f"Size ({len(SIZE_MODIFIERS)} options) and Toppings ({len(TOPPING_MODIFIERS)} options) modifier groups."
        ))
