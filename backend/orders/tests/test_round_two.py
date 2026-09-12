"""Adding a second round of items after an order already went to the
kitchen once — previously blocked outright: OrderViewSet.add_item had no
guard of its own, but the UI disabled adding once the order left OPEN/
HELD, and send_to_kitchen() unconditionally re-ticketed *every* item
(including ones already sent), so calling it twice would have duplicated
tickets. Covers that a second send only tickets the new items, that a
round-2 item stays freely editable until *it* is sent, and that an
already-ticketed item can't be edited from here even though the order
overall is well past OPEN/HELD.
"""

from decimal import Decimal

from rest_framework.test import APITestCase

from accounts.models import User
from catalog.models import MenuItem
from orders.models import KitchenTicket, KitchenTicketItem, Order, OrderItem
from organizations.models import Organization, Store


def make_org_store():
    org = Organization.objects.create(
        name="Round Two Org", slug="round-two-org", business_type=Organization.BusinessType.RESTAURANT
    )
    store = Store.objects.create(organization=org, store_type=Store.StoreType.RESTAURANT, name="Main")
    return org, store


class RoundTwoOrderingTests(APITestCase):
    def setUp(self):
        self.org, self.store = make_org_store()
        self.user = User.objects.create_user(
            email="cashier@roundtwo.test", password="testpass123", organization=self.org
        )
        self.client.force_authenticate(self.user)
        self.menu_item = MenuItem.objects.create(
            organization=self.org, store=self.store, name="Coke", price=Decimal("100")
        )
        self.order = Order.objects.create(
            organization=self.org, store=self.store, order_type=Order.OrderType.DINE_IN
        )

    def _send_to_kitchen(self):
        return self.client.post(f"/api/orders/{self.order.id}/send-to-kitchen/")

    def _add_item(self):
        return self.client.post(
            f"/api/orders/{self.order.id}/items/", {"menu_item": str(self.menu_item.id), "quantity": 1}
        )

    def test_can_add_item_after_order_already_sent_to_kitchen(self):
        self._add_item()
        self._send_to_kitchen()
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.Status.SENT_TO_KITCHEN)

        response = self._add_item()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(OrderItem.objects.filter(order=self.order).count(), 2)

    def test_second_send_to_kitchen_only_tickets_the_new_item(self):
        self._add_item()
        self._send_to_kitchen()
        self.assertEqual(KitchenTicket.objects.filter(order=self.order).count(), 1)

        self._add_item()
        response = self._send_to_kitchen()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(KitchenTicket.objects.filter(order=self.order).count(), 2)
        self.assertEqual(KitchenTicketItem.objects.filter(order_item__order=self.order).count(), 2)

    def test_send_to_kitchen_with_nothing_new_is_rejected(self):
        self._add_item()
        self._send_to_kitchen()

        response = self._send_to_kitchen()
        self.assertEqual(response.status_code, 400)

    def test_round_two_item_is_editable_before_its_own_send(self):
        self._add_item()
        self._send_to_kitchen()
        add_response = self._add_item()
        new_item_id = add_response.data["items"][-1]["id"]

        response = self.client.patch(f"/api/orders/{self.order.id}/items/{new_item_id}/", {"quantity": 3})
        self.assertEqual(response.status_code, 200)

    def test_already_ticketed_item_cannot_be_edited_even_from_a_later_call(self):
        add_response = self._add_item()
        first_item_id = add_response.data["items"][0]["id"]
        self._send_to_kitchen()
        self._add_item()  # a second, not-yet-sent item now also exists

        response = self.client.patch(f"/api/orders/{self.order.id}/items/{first_item_id}/", {"quantity": 5})
        self.assertEqual(response.status_code, 400)

    def test_sent_to_kitchen_flag_reflects_per_item_state(self):
        self._add_item()
        self._send_to_kitchen()
        self._add_item()

        # OrderItem has no explicit ordering, so items[0]/[1] isn't a safe
        # way to tell which is which — count by flag instead, which is
        # order-independent and still proves exactly one of each exists.
        response = self.client.get(f"/api/orders/{self.order.id}/")
        items = response.data["items"]
        sent_flags = sorted(item["sent_to_kitchen"] for item in items)
        self.assertEqual(sent_flags, [False, True])

    def test_cannot_add_item_to_a_billed_order(self):
        self._add_item()
        self._send_to_kitchen()
        self.order.bill()

        response = self._add_item()
        self.assertEqual(response.status_code, 400)
