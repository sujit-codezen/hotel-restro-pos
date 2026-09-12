"""Discounts (Phase 2). Covers percent vs. fixed computation, the guard
against changing a discount after money has changed hands, the
never-below-zero clamp, and removal.
"""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from billing.models import Discount, Invoice, InvoiceLine, Payment
from organizations.models import Organization, Store


def make_org_store():
    org = Organization.objects.create(
        name="Test Org", slug="test-org-discount", business_type=Organization.BusinessType.RESTAURANT
    )
    store = Store.objects.create(
        organization=org, store_type=Store.StoreType.RESTAURANT, name="Main"
    )
    return org, store


class DiscountTests(TestCase):
    def setUp(self):
        self.org, self.store = make_org_store()
        self.invoice = Invoice.objects.create(
            organization=self.org, store=self.store, source_type=Invoice.SourceType.ORDER
        )
        InvoiceLine.objects.create(
            organization=self.org,
            invoice=self.invoice,
            description="Item",
            quantity=1,
            unit_price=Decimal("1000"),
            source_type=InvoiceLine.SourceType.MENU_ITEM,
        )
        self.invoice.recompute_totals()

    def test_percent_discount(self):
        discount = Discount.objects.create(
            organization=self.org, name="10% off", type=Discount.Type.PERCENT, value=Decimal("10")
        )
        self.invoice.apply_discount(discount)
        self.assertEqual(self.invoice.discount_total, Decimal("100.00"))
        self.assertEqual(self.invoice.grand_total, Decimal("900.00"))

    def test_fixed_discount(self):
        discount = Discount.objects.create(
            organization=self.org, name="Rs 150 off", type=Discount.Type.FIXED, value=Decimal("150")
        )
        self.invoice.apply_discount(discount)
        self.assertEqual(self.invoice.discount_total, Decimal("150.00"))
        self.assertEqual(self.invoice.grand_total, Decimal("850.00"))

    def test_fixed_discount_never_exceeds_subtotal(self):
        discount = Discount.objects.create(
            organization=self.org, name="Huge", type=Discount.Type.FIXED, value=Decimal("5000")
        )
        self.invoice.apply_discount(discount)
        self.assertEqual(self.invoice.discount_total, self.invoice.subtotal)
        self.assertEqual(self.invoice.grand_total, Decimal("0.00"))

    def test_remove_discount_restores_grand_total(self):
        discount = Discount.objects.create(
            organization=self.org, name="10% off", type=Discount.Type.PERCENT, value=Decimal("10")
        )
        self.invoice.apply_discount(discount)
        self.invoice.remove_discount()
        self.assertIsNone(self.invoice.discount)
        self.assertEqual(self.invoice.discount_total, Decimal("0"))
        self.assertEqual(self.invoice.grand_total, self.invoice.subtotal)

    def test_cannot_change_discount_after_payment(self):
        discount = Discount.objects.create(
            organization=self.org, name="10% off", type=Discount.Type.PERCENT, value=Decimal("10")
        )
        Payment.objects.create(
            organization=self.org, invoice=self.invoice, method=Payment.Method.CASH, amount=Decimal("100")
        )
        self.invoice.apply_payment()
        with self.assertRaises(ValidationError):
            self.invoice.apply_discount(discount)

    def test_cannot_remove_discount_after_payment(self):
        discount = Discount.objects.create(
            organization=self.org, name="10% off", type=Discount.Type.PERCENT, value=Decimal("10")
        )
        self.invoice.apply_discount(discount)
        Payment.objects.create(
            organization=self.org, invoice=self.invoice, method=Payment.Method.CASH, amount=Decimal("100")
        )
        self.invoice.apply_payment()
        with self.assertRaises(ValidationError):
            self.invoice.remove_discount()
