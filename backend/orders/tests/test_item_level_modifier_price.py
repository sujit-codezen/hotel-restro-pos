"""An order item's modifier is priced from the (menu_item, modifier)
item-level override when one exists — set via /menu-items/{id}/item-
modifiers/ — falling back to the Modifier's own default price only when
no override is on record for that item. Covers the actual reason the
per-item pricing feature exists: the same "Large" option billing
differently depending on which dish it's added to.
"""

from decimal import Decimal

from rest_framework.test import APITestCase

from accounts.models import User
from catalog.models import MenuItem, MenuItemModifier, Modifier, ModifierGroup
from orders.models import Order, OrderItem, OrderItemModifier
from organizations.models import Organization, Store


def make_org_store():
    org = Organization.objects.create(
        name="Item Price Order Org",
        slug="item-price-order-org",
        business_type=Organization.BusinessType.RESTAURANT,
    )
    store = Store.objects.create(organization=org, store_type=Store.StoreType.RESTAURANT, name="Main")
    return org, store


class ItemLevelModifierPriceInOrdersTests(APITestCase):
    def setUp(self):
        self.org, self.store = make_org_store()
        self.user = User.objects.create_user(
            email="cashier@itempriceorder.test", password="testpass123", organization=self.org
        )
        self.client.force_authenticate(self.user)

        self.pizza = MenuItem.objects.create(
            organization=self.org, store=self.store, name="Margherita Pizza", price=Decimal("650")
        )
        self.size_group = ModifierGroup.objects.create(
            organization=self.org, store=self.store, name="Size", selection_type="SINGLE"
        )
        self.large = Modifier.objects.create(
            organization=self.org, modifier_group=self.size_group, name="Large", price_delta=Decimal("100")
        )
        self.order = Order.objects.create(
            organization=self.org, store=self.store, order_type=Order.OrderType.DINE_IN
        )

    def _add_item(self):
        return self.client.post(
            f"/api/orders/{self.order.id}/items/",
            {"menu_item": str(self.pizza.id), "quantity": 1, "modifiers": [str(self.large.id)]},
        )

    def test_uses_the_modifiers_default_price_when_no_item_level_override_exists(self):
        self._add_item()
        order_item_modifier = OrderItemModifier.objects.get(order_item__order=self.order)
        self.assertEqual(order_item_modifier.price_delta, Decimal("100"))

    def test_uses_the_item_level_override_price_when_one_is_set(self):
        MenuItemModifier.objects.create(
            organization=self.org, menu_item=self.pizza, modifier=self.large, price_delta=Decimal("300")
        )
        self._add_item()
        order_item_modifier = OrderItemModifier.objects.get(order_item__order=self.order)
        self.assertEqual(order_item_modifier.price_delta, Decimal("300"))

    def test_order_item_snapshot_is_unaffected_by_a_later_price_change(self):
        MenuItemModifier.objects.create(
            organization=self.org, menu_item=self.pizza, modifier=self.large, price_delta=Decimal("300")
        )
        self._add_item()

        MenuItemModifier.objects.filter(menu_item=self.pizza, modifier=self.large).update(price_delta=Decimal("500"))

        order_item_modifier = OrderItemModifier.objects.get(order_item__order=self.order)
        self.assertEqual(order_item_modifier.price_delta, Decimal("300"))
