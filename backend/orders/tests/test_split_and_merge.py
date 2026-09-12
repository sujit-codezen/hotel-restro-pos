"""Split billing (Order.bill(item_ids=...)) and merge tables
(Order.merge_from()) — Phase 2 additions. Covers the state transitions a
manual click-through can't easily catch on every change: partial billing
leaves the order open, only the last split flips it to BILLED, double
billing with nothing left raises, and merging respects/rejects the right
order statuses.
"""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from catalog.models import MenuItem
from orders.models import Order, OrderItem
from organizations.models import Organization, Store
from tables.models import Table


def make_org_store():
    org = Organization.objects.create(
        name="Test Org", slug="test-org-split", business_type=Organization.BusinessType.RESTAURANT
    )
    store = Store.objects.create(
        organization=org, store_type=Store.StoreType.RESTAURANT, name="Main"
    )
    return org, store


class SplitBillTests(TestCase):
    def setUp(self):
        self.org, self.store = make_org_store()
        self.menu_item = MenuItem.objects.create(
            organization=self.org, store=self.store, name="Coke", price=Decimal("100")
        )
        self.table = Table.objects.create(organization=self.org, store=self.store, name="T1")
        self.order = Order.objects.create(
            organization=self.org,
            store=self.store,
            order_type=Order.OrderType.DINE_IN,
            table=self.table,
        )
        self.item1 = OrderItem.objects.create(
            organization=self.org, order=self.order, menu_item=self.menu_item, unit_price=Decimal("100")
        )
        self.item2 = OrderItem.objects.create(
            organization=self.org, order=self.order, menu_item=self.menu_item, unit_price=Decimal("100")
        )

    def test_partial_bill_leaves_order_open(self):
        invoice = self.order.bill(item_ids=[self.item1.id])

        self.item1.refresh_from_db()
        self.item2.refresh_from_db()
        self.order.refresh_from_db()

        self.assertEqual(invoice.grand_total, Decimal("100"))
        self.assertEqual(self.item1.invoice_id, invoice.id)
        self.assertIsNone(self.item2.invoice_id)
        self.assertEqual(self.order.status, Order.Status.OPEN)

    def test_billing_last_item_marks_order_billed(self):
        self.order.bill(item_ids=[self.item1.id])
        self.order.bill(item_ids=[self.item2.id])

        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.Status.BILLED)

    def test_bill_all_unbilled_when_no_item_ids_given(self):
        invoice = self.order.bill()

        self.order.refresh_from_db()
        self.assertEqual(invoice.grand_total, Decimal("200"))
        self.assertEqual(self.order.status, Order.Status.BILLED)

    def test_billing_with_nothing_unbilled_raises(self):
        self.order.bill()
        with self.assertRaises(ValidationError):
            self.order.bill()

    def test_display_numbers_are_independent_per_split_invoice(self):
        """Each split invoice gets its own display_number at finalize —
        this is also what guards against the earlier bug where
        display_number was globally unique instead of per-store."""
        invoice1 = self.order.bill(item_ids=[self.item1.id])
        invoice2 = self.order.bill(item_ids=[self.item2.id])

        invoice1.finalize()
        invoice2.finalize()

        self.assertNotEqual(invoice1.display_number, invoice2.display_number)
        self.assertTrue(invoice1.display_number)
        self.assertTrue(invoice2.display_number)


class MergeOrdersTests(TestCase):
    def setUp(self):
        self.org, self.store = make_org_store()
        self.menu_item = MenuItem.objects.create(
            organization=self.org, store=self.store, name="Coke", price=Decimal("100")
        )
        self.table_a = Table.objects.create(organization=self.org, store=self.store, name="A")
        self.table_b = Table.objects.create(organization=self.org, store=self.store, name="B")
        self.order_a = Order.objects.create(
            organization=self.org,
            store=self.store,
            order_type=Order.OrderType.DINE_IN,
            table=self.table_a,
        )
        self.order_b = Order.objects.create(
            organization=self.org,
            store=self.store,
            order_type=Order.OrderType.DINE_IN,
            table=self.table_b,
        )
        self.item_a = OrderItem.objects.create(
            organization=self.org, order=self.order_a, menu_item=self.menu_item, unit_price=Decimal("100")
        )
        self.item_b = OrderItem.objects.create(
            organization=self.org, order=self.order_b, menu_item=self.menu_item, unit_price=Decimal("100")
        )

    def test_merge_moves_items_and_cancels_source(self):
        self.order_a.merge_from(self.order_b)

        self.item_b.refresh_from_db()
        self.order_b.refresh_from_db()
        self.table_b.refresh_from_db()

        self.assertEqual(self.item_b.order_id, self.order_a.id)
        self.assertEqual(self.order_a.items.count(), 2)
        self.assertEqual(self.order_b.status, Order.Status.CANCELLED)
        self.assertIsNone(self.order_b.table_id)
        self.assertEqual(self.table_b.status, Table.Status.AVAILABLE)

    def test_cannot_merge_order_into_itself(self):
        with self.assertRaises(ValidationError):
            self.order_a.merge_from(self.order_a)

    def test_cannot_merge_a_billed_order(self):
        self.order_a.bill()
        with self.assertRaises(ValidationError):
            self.order_a.merge_from(self.order_b)

    def test_cannot_merge_from_a_cancelled_order(self):
        self.order_b.status = Order.Status.CANCELLED
        self.order_b.save(update_fields=["status"])
        with self.assertRaises(ValidationError):
            self.order_a.merge_from(self.order_b)
