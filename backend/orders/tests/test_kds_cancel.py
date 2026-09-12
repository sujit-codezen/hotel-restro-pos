"""Cancelling a single item on an already-sent kitchen ticket — the one
thing OrderViewSet.edit_item explicitly can't do once an order has left
OPEN/HELD (see its docstring). Also covers KitchenTicket.refresh_status()
correctly excluding CANCELLED items from its NEW<COOKING<READY<SERVED
ranking, and Order.unbilled_items() never billing a cancelled item.
"""

from decimal import Decimal

from rest_framework.test import APITestCase

from accounts.models import User
from catalog.models import MenuItem, Modifier, ModifierGroup
from orders.models import KitchenTicket, KitchenTicketItem, Order, OrderItem, OrderItemModifier
from organizations.models import Organization, Store
from tables.models import Table


def make_org_store():
    org = Organization.objects.create(
        name="KDS Test Org", slug="kds-test-org", business_type=Organization.BusinessType.RESTAURANT
    )
    store = Store.objects.create(organization=org, store_type=Store.StoreType.RESTAURANT, name="Main")
    return org, store


class CancelItemModelTests(APITestCase):
    def setUp(self):
        self.org, self.store = make_org_store()
        self.menu_item = MenuItem.objects.create(
            organization=self.org, store=self.store, name="Coke", price=Decimal("100")
        )
        self.order = Order.objects.create(
            organization=self.org, store=self.store, order_type=Order.OrderType.TAKEAWAY
        )
        self.item1 = OrderItem.objects.create(
            organization=self.org, order=self.order, menu_item=self.menu_item, unit_price=Decimal("100")
        )
        self.item2 = OrderItem.objects.create(
            organization=self.org, order=self.order, menu_item=self.menu_item, unit_price=Decimal("100")
        )
        self.ticket = KitchenTicket.objects.create(
            organization=self.org, store=self.store, order=self.order, kitchen_station="Kitchen"
        )
        self.ti1 = KitchenTicketItem.objects.create(
            organization=self.org, kitchen_ticket=self.ticket, order_item=self.item1
        )
        self.ti2 = KitchenTicketItem.objects.create(
            organization=self.org, kitchen_ticket=self.ticket, order_item=self.item2
        )

    def test_cancelled_item_excluded_from_unbilled_items(self):
        self.item1.status = OrderItem.Status.CANCELLED
        self.item1.save(update_fields=["status"])

        unbilled = list(self.order.unbilled_items())
        self.assertNotIn(self.item1, unbilled)
        self.assertIn(self.item2, unbilled)

    def test_ticket_status_ignores_cancelled_item(self):
        self.item1.status = OrderItem.Status.CANCELLED
        self.item1.save(update_fields=["status"])
        self.item2.status = OrderItem.Status.READY
        self.item2.save(update_fields=["status"])

        self.ticket.refresh_status()
        self.assertEqual(self.ticket.status, KitchenTicket.Status.READY)

    def test_ticket_with_every_item_cancelled_counts_as_served(self):
        self.item1.status = OrderItem.Status.CANCELLED
        self.item1.save(update_fields=["status"])
        self.item2.status = OrderItem.Status.CANCELLED
        self.item2.save(update_fields=["status"])

        self.ticket.refresh_status()
        self.assertEqual(self.ticket.status, KitchenTicket.Status.SERVED)


class CancelItemAPITests(APITestCase):
    def setUp(self):
        self.org, self.store = make_org_store()
        self.user = User.objects.create_user(
            email="cook@kdstest.test", password="testpass123", organization=self.org
        )
        self.client.force_authenticate(self.user)

        self.menu_item = MenuItem.objects.create(
            organization=self.org, store=self.store, name="Coke", price=Decimal("100")
        )
        self.order = Order.objects.create(
            organization=self.org, store=self.store, order_type=Order.OrderType.TAKEAWAY
        )
        self.item = OrderItem.objects.create(
            organization=self.org, order=self.order, menu_item=self.menu_item, unit_price=Decimal("100")
        )
        self.ticket = KitchenTicket.objects.create(
            organization=self.org, store=self.store, order=self.order, kitchen_station="Kitchen"
        )
        self.ticket_item = KitchenTicketItem.objects.create(
            organization=self.org, kitchen_ticket=self.ticket, order_item=self.item
        )

    def _cancel(self):
        return self.client.post(f"/api/kitchen-tickets/{self.ticket.id}/items/{self.item.id}/cancel/")

    def test_can_cancel_a_new_item(self):
        response = self._cancel()
        self.assertEqual(response.status_code, 200)
        self.item.refresh_from_db()
        self.assertEqual(self.item.status, OrderItem.Status.CANCELLED)

    def test_cannot_cancel_an_already_billed_item(self):
        self.order.bill()
        self.item.refresh_from_db()
        self.assertIsNotNone(self.item.invoice_id)

        response = self._cancel()
        self.assertEqual(response.status_code, 400)
        self.item.refresh_from_db()
        self.assertNotEqual(self.item.status, OrderItem.Status.CANCELLED)

    def test_cannot_cancel_a_served_item(self):
        self.item.status = OrderItem.Status.SERVED
        self.item.save(update_fields=["status"])

        response = self._cancel()
        self.assertEqual(response.status_code, 400)

    def test_cannot_cancel_twice(self):
        self._cancel()
        response = self._cancel()
        self.assertEqual(response.status_code, 400)

    def test_menu_item_name_included_in_response(self):
        response = self.client.get(f"/api/kitchen-tickets/?store={self.store.id}")
        self.assertEqual(response.status_code, 200)
        ticket_data = response.data["results"][0]
        self.assertEqual(ticket_data["ticket_items"][0]["order_item"]["menu_item_name"], "Coke")

    def test_table_less_order_reports_null_table_name(self):
        response = self.client.get(f"/api/kitchen-tickets/?store={self.store.id}")
        ticket_data = response.data["results"][0]
        self.assertEqual(ticket_data["order_type"], "TAKEAWAY")
        self.assertIsNone(ticket_data["table_name"])

    def test_dine_in_order_reports_its_table_name(self):
        table = Table.objects.create(organization=self.org, store=self.store, name="T07")
        dine_in_order = Order.objects.create(
            organization=self.org, store=self.store, order_type=Order.OrderType.DINE_IN, table=table
        )
        item = OrderItem.objects.create(
            organization=self.org, order=dine_in_order, menu_item=self.menu_item, unit_price=Decimal("100")
        )
        ticket = KitchenTicket.objects.create(
            organization=self.org, store=self.store, order=dine_in_order, kitchen_station="Kitchen"
        )
        KitchenTicketItem.objects.create(organization=self.org, kitchen_ticket=ticket, order_item=item)

        response = self.client.get(f"/api/kitchen-tickets/?store={self.store.id}&status=NEW")
        ticket_data = next(r for r in response.data["results"] if r["id"] == str(ticket.id))
        self.assertEqual(ticket_data["order_type"], "DINE_IN")
        self.assertEqual(ticket_data["table_name"], "T07")

    def test_modifier_name_and_group_included_in_response(self):
        size_group = ModifierGroup.objects.create(
            organization=self.org, store=self.store, name="Size",
            selection_type=ModifierGroup.SelectionType.SINGLE,
        )
        large = Modifier.objects.create(
            organization=self.org, modifier_group=size_group, name="Large", price_delta=Decimal("150")
        )
        OrderItemModifier.objects.create(
            organization=self.org, order_item=self.item, modifier=large, price_delta=large.price_delta
        )

        response = self.client.get(f"/api/kitchen-tickets/?store={self.store.id}")
        modifier_data = response.data["results"][0]["ticket_items"][0]["order_item"]["modifiers"][0]
        self.assertEqual(modifier_data["modifier_name"], "Large")
        self.assertEqual(modifier_data["modifier_group_name"], "Size")
