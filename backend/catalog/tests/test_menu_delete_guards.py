"""Delete guards for the menu-management ViewSets, added alongside the
unified Menu admin page: MenuItem/Modifier/ModifierGroup all sit behind
PROTECT foreign keys from order history (OrderItem.menu_item,
OrderItemModifier.modifier), so a hard delete of one that's ever been
ordered must surface a friendly 400, not a raw 500 — and cascading a
ModifierGroup delete through a used Modifier must be caught the same way.

Also covers that overriding perform_destroy on these ViewSets didn't
silently drop RequiresPermissionMixin's can_manage_menu gate.
"""

from decimal import Decimal

from rest_framework.test import APITestCase

from accounts.models import Role, StoreStaff, User
from catalog.models import MenuItem, Modifier, ModifierGroup
from orders.models import Order, OrderItem, OrderItemModifier
from organizations.models import Organization, Store


def make_org_store():
    org = Organization.objects.create(
        name="Menu Guard Org", slug="menu-guard-org", business_type=Organization.BusinessType.RESTAURANT
    )
    store = Store.objects.create(organization=org, store_type=Store.StoreType.RESTAURANT, name="Main")
    return org, store


def make_staff_user(org, store, email, **role_flags):
    user = User.objects.create_user(email=email, password="testpass123", organization=org)
    role = Role.objects.create(organization=org, name=f"Role for {email}", **role_flags)
    StoreStaff.objects.create(user=user, store=store, role=role)
    return user


class MenuDeleteGuardTests(APITestCase):
    def setUp(self):
        self.org, self.store = make_org_store()
        self.manager = make_staff_user(self.org, self.store, "manager@menuguard.test", can_manage_menu=True)
        self.cashier = make_staff_user(self.org, self.store, "cashier@menuguard.test")

        self.item = MenuItem.objects.create(
            organization=self.org, store=self.store, name="Momo", price=Decimal("250")
        )
        self.group = ModifierGroup.objects.create(
            organization=self.org, store=self.store, name="Spice level", selection_type="SINGLE"
        )
        self.modifier = Modifier.objects.create(
            organization=self.org, modifier_group=self.group, name="Extra spicy", price_delta=Decimal("0")
        )

        self.order = Order.objects.create(organization=self.org, store=self.store, order_type="DINE_IN")
        self.order_item = OrderItem.objects.create(
            organization=self.org, order=self.order, menu_item=self.item, unit_price=Decimal("250")
        )

    def _order_the_modifier(self):
        OrderItemModifier.objects.create(
            organization=self.org, order_item=self.order_item, modifier=self.modifier, price_delta=Decimal("0")
        )

    def test_cannot_delete_a_menu_item_with_order_history(self):
        self.client.force_authenticate(self.manager)
        response = self.client.delete(f"/api/menu-items/{self.item.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertTrue(MenuItem.objects.filter(id=self.item.id).exists())

    def test_can_delete_an_unused_menu_item(self):
        self.client.force_authenticate(self.manager)
        unused = MenuItem.objects.create(
            organization=self.org, store=self.store, name="Unused Dish", price=Decimal("100")
        )
        response = self.client.delete(f"/api/menu-items/{unused.id}/")
        self.assertEqual(response.status_code, 204)

    def test_cashier_without_permission_cannot_delete_menu_item(self):
        self.client.force_authenticate(self.cashier)
        unused = MenuItem.objects.create(
            organization=self.org, store=self.store, name="Unused Dish 2", price=Decimal("100")
        )
        response = self.client.delete(f"/api/menu-items/{unused.id}/")
        self.assertEqual(response.status_code, 403)
        self.assertTrue(MenuItem.objects.filter(id=unused.id).exists())

    def test_cannot_delete_a_modifier_with_order_history(self):
        self._order_the_modifier()
        self.client.force_authenticate(self.manager)
        response = self.client.delete(f"/api/modifiers/{self.modifier.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertTrue(Modifier.objects.filter(id=self.modifier.id).exists())

    def test_can_delete_an_unused_modifier(self):
        self.client.force_authenticate(self.manager)
        response = self.client.delete(f"/api/modifiers/{self.modifier.id}/")
        self.assertEqual(response.status_code, 204)

    def test_cashier_without_permission_cannot_delete_modifier(self):
        self.client.force_authenticate(self.cashier)
        response = self.client.delete(f"/api/modifiers/{self.modifier.id}/")
        self.assertEqual(response.status_code, 403)
        self.assertTrue(Modifier.objects.filter(id=self.modifier.id).exists())

    def test_cannot_delete_a_modifier_group_whose_modifier_has_order_history(self):
        self._order_the_modifier()
        self.client.force_authenticate(self.manager)
        response = self.client.delete(f"/api/modifier-groups/{self.group.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertTrue(ModifierGroup.objects.filter(id=self.group.id).exists())

    def test_can_delete_an_unused_modifier_group(self):
        self.client.force_authenticate(self.manager)
        response = self.client.delete(f"/api/modifier-groups/{self.group.id}/")
        self.assertEqual(response.status_code, 204)
