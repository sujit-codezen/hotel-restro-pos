"""Order.bill() computing tax from MenuItem.tax_class (Phase 2) — was
previously always 0 regardless of a TaxClass being set. Exclusive tax
adds on top of the invoice total; inclusive tax is deliberately left
at tax_amount=0 until recompute_totals() can be taught not to add it
again on top of an already-tax-included price.
"""

from decimal import Decimal

from django.test import TestCase

from catalog.models import MenuItem, TaxClass
from orders.models import Order, OrderItem
from organizations.models import Organization, Store


def make_org_store():
    org = Organization.objects.create(
        name="Test Org", slug="test-org-tax", business_type=Organization.BusinessType.RESTAURANT
    )
    store = Store.objects.create(
        organization=org, store_type=Store.StoreType.RESTAURANT, name="Main"
    )
    return org, store


class TaxComputationTests(TestCase):
    def setUp(self):
        self.org, self.store = make_org_store()
        self.table = None

    def make_order_with_item(self, tax_class=None, price=Decimal("500"), quantity=Decimal("2")):
        menu_item = MenuItem.objects.create(
            organization=self.org, store=self.store, name="Dish", price=price, tax_class=tax_class
        )
        order = Order.objects.create(
            organization=self.org, store=self.store, order_type=Order.OrderType.DINE_IN
        )
        OrderItem.objects.create(
            organization=self.org, order=order, menu_item=menu_item, unit_price=price, quantity=quantity
        )
        return order

    def test_exclusive_tax_adds_to_grand_total(self):
        tax_class = TaxClass.objects.create(
            organization=self.org, name="VAT", rate_percent=Decimal("13"), is_inclusive=False
        )
        order = self.make_order_with_item(tax_class=tax_class)
        invoice = order.bill()

        # subtotal = 500 * 2 = 1000; tax = 13% of 1000 = 130
        self.assertEqual(invoice.subtotal, Decimal("1000.00"))
        self.assertEqual(invoice.tax_total, Decimal("130.00"))
        self.assertEqual(invoice.grand_total, Decimal("1130.00"))

    def test_no_tax_class_means_zero_tax(self):
        order = self.make_order_with_item(tax_class=None)
        invoice = order.bill()
        self.assertEqual(invoice.tax_total, Decimal("0.00"))
        self.assertEqual(invoice.grand_total, invoice.subtotal)

    def test_inclusive_tax_class_reports_zero_not_double_charged(self):
        """Known limitation, asserted explicitly: an inclusive TaxClass
        doesn't get double-added on top of a price that already contains
        it — so tax_amount stays 0 rather than inflating grand_total."""
        tax_class = TaxClass.objects.create(
            organization=self.org, name="Inclusive VAT", rate_percent=Decimal("13"), is_inclusive=True
        )
        order = self.make_order_with_item(tax_class=tax_class)
        invoice = order.bill()
        self.assertEqual(invoice.tax_total, Decimal("0.00"))
        self.assertEqual(invoice.grand_total, invoice.subtotal)
