"""Per-item modifier availability and pricing (MenuItemModifier) — the
follow-up to attaching a group to an item. Modifier.price_delta is only a
starting default; once a group is attached, every option is seeded at
that default, and the item owner can uncheck options that don't apply to
this specific dish and/or reprice the ones that remain, independent of
what the same option costs on any other item that shares the group.
"""

from decimal import Decimal

from rest_framework.test import APITestCase

from accounts.models import Role, StoreStaff, User
from catalog.models import MenuItem, MenuItemModifier, Modifier, ModifierGroup
from organizations.models import Organization, Store


def make_org_store():
    org = Organization.objects.create(
        name="Item Modifier Price Org",
        slug="item-modifier-price-org",
        business_type=Organization.BusinessType.RESTAURANT,
    )
    store = Store.objects.create(organization=org, store_type=Store.StoreType.RESTAURANT, name="Main")
    return org, store


def make_staff_user(org, store, email, **role_flags):
    user = User.objects.create_user(email=email, password="testpass123", organization=org)
    role = Role.objects.create(organization=org, name=f"Role for {email}", **role_flags)
    StoreStaff.objects.create(user=user, store=store, role=role)
    return user


class MenuItemModifierPriceTests(APITestCase):
    def setUp(self):
        self.org, self.store = make_org_store()
        self.manager = make_staff_user(self.org, self.store, "manager@itemprice.test", can_manage_menu=True)
        self.cashier = make_staff_user(self.org, self.store, "cashier@itemprice.test")

        self.pizza = MenuItem.objects.create(
            organization=self.org, store=self.store, name="Margherita Pizza", price=Decimal("650")
        )
        self.momo = MenuItem.objects.create(
            organization=self.org, store=self.store, name="Chicken Momo", price=Decimal("250")
        )
        self.size_group = ModifierGroup.objects.create(
            organization=self.org, store=self.store, name="Size", selection_type="SINGLE"
        )
        self.small = Modifier.objects.create(
            organization=self.org, modifier_group=self.size_group, name="Small", price_delta=Decimal("0")
        )
        self.large = Modifier.objects.create(
            organization=self.org, modifier_group=self.size_group, name="Large", price_delta=Decimal("100")
        )

    def _attach_size_to(self, item):
        self.client.force_authenticate(self.manager)
        return self.client.post(f"/api/menu-items/{item.id}/modifier-groups/", {"modifier_group": str(self.size_group.id)})

    def test_attaching_a_group_seeds_every_option_at_its_default_price(self):
        response = self._attach_size_to(self.pizza)
        sizes = {m["name"]: m["price_delta"] for m in response.data["modifier_groups"][0]["modifiers"]}
        self.assertEqual(sizes, {"Small": "0.00", "Large": "100.00"})

    def test_the_same_option_can_be_priced_differently_per_item(self):
        self._attach_size_to(self.pizza)
        self._attach_size_to(self.momo)

        # Large pizza costs a lot more extra than a large momo — reprice
        # the pizza's "Large" only.
        self.client.force_authenticate(self.manager)
        self.client.post(
            f"/api/menu-items/{self.pizza.id}/item-modifiers/",
            {"modifier": str(self.large.id), "price_delta": "300"},
        )

        pizza = self.client.get(f"/api/menu-items/{self.pizza.id}/").data
        momo = self.client.get(f"/api/menu-items/{self.momo.id}/").data
        pizza_large = next(m for m in pizza["modifier_groups"][0]["modifiers"] if m["name"] == "Large")
        momo_large = next(m for m in momo["modifier_groups"][0]["modifiers"] if m["name"] == "Large")
        self.assertEqual(pizza_large["price_delta"], "300.00")
        self.assertEqual(momo_large["price_delta"], "100.00")
        # The global Modifier default is untouched by an item-level reprice.
        self.large.refresh_from_db()
        self.assertEqual(self.large.price_delta, Decimal("100.00"))

    def test_can_mark_an_option_unavailable_on_one_item_without_affecting_others(self):
        self._attach_size_to(self.pizza)
        self._attach_size_to(self.momo)

        self.client.force_authenticate(self.manager)
        response = self.client.delete(f"/api/menu-items/{self.momo.id}/item-modifiers/{self.small.id}/")
        self.assertEqual(response.status_code, 200)

        momo_sizes = [m["name"] for m in response.data["modifier_groups"][0]["modifiers"]]
        self.assertEqual(momo_sizes, ["Large"])

        pizza = self.client.get(f"/api/menu-items/{self.pizza.id}/").data
        pizza_sizes = {m["name"] for m in pizza["modifier_groups"][0]["modifiers"]}
        self.assertEqual(pizza_sizes, {"Small", "Large"})

    def test_cannot_set_a_price_for_a_group_not_attached_to_the_item(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            f"/api/menu-items/{self.pizza.id}/item-modifiers/",
            {"modifier": str(self.small.id), "price_delta": "50"},
        )
        self.assertEqual(response.status_code, 400)

    def test_set_item_modifier_rejects_a_non_numeric_price(self):
        self._attach_size_to(self.pizza)
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            f"/api/menu-items/{self.pizza.id}/item-modifiers/",
            {"modifier": str(self.small.id), "price_delta": "not-a-number"},
        )
        self.assertEqual(response.status_code, 400)

    def test_detaching_a_group_clears_its_item_level_overrides(self):
        self._attach_size_to(self.pizza)
        self.client.force_authenticate(self.manager)
        self.client.delete(f"/api/menu-items/{self.pizza.id}/modifier-groups/{self.size_group.id}/")
        self.assertFalse(MenuItemModifier.objects.filter(menu_item=self.pizza).exists())

    def test_cashier_without_permission_cannot_set_item_modifier_price(self):
        self._attach_size_to(self.pizza)
        self.client.force_authenticate(self.cashier)
        response = self.client.post(
            f"/api/menu-items/{self.pizza.id}/item-modifiers/",
            {"modifier": str(self.small.id), "price_delta": "50"},
        )
        self.assertEqual(response.status_code, 403)

    def test_cashier_without_permission_cannot_unset_item_modifier(self):
        self._attach_size_to(self.pizza)
        self.client.force_authenticate(self.cashier)
        response = self.client.delete(f"/api/menu-items/{self.pizza.id}/item-modifiers/{self.small.id}/")
        self.assertEqual(response.status_code, 403)
