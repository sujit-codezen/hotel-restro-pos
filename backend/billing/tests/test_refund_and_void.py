"""Refunds and voids (Phase 2). Covers the status recomputation net of
refunds, the guard against over-refunding a single payment, and void()'s
refusal to cancel an invoice that still has money outstanding on it.
"""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from billing.models import Invoice, InvoiceLine, Payment
from organizations.models import Organization, Store


def make_org_store():
    org = Organization.objects.create(
        name="Test Org", slug="test-org-refund", business_type=Organization.BusinessType.RESTAURANT
    )
    store = Store.objects.create(
        organization=org, store_type=Store.StoreType.RESTAURANT, name="Main"
    )
    return org, store


class RefundTests(TestCase):
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
            unit_price=Decimal("500"),
            source_type=InvoiceLine.SourceType.MENU_ITEM,
        )
        self.invoice.recompute_totals()
        self.payment = Payment.objects.create(
            organization=self.org, invoice=self.invoice, method=Payment.Method.CASH, amount=Decimal("500")
        )
        self.invoice.apply_payment()

    def test_full_refund_reverts_invoice_to_unpaid(self):
        self.payment.refund(Decimal("500"))
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, Invoice.Status.UNPAID)
        self.assertEqual(self.invoice.grand_total - self.invoice._net_paid(), Decimal("500"))

    def test_partial_refund_leaves_invoice_partially_paid(self):
        self.payment.refund(Decimal("200"))
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, Invoice.Status.PARTIALLY_PAID)
        self.assertEqual(self.invoice._net_paid(), Decimal("300"))

    def test_cannot_refund_more_than_the_payment(self):
        with self.assertRaises(ValidationError):
            self.payment.refund(Decimal("600"))

    def test_cannot_refund_more_than_remains_after_a_prior_refund(self):
        self.payment.refund(Decimal("300"))
        with self.assertRaises(ValidationError):
            self.payment.refund(Decimal("300"))  # only 200 left

    def test_two_partial_refunds_that_exactly_exhaust_the_payment(self):
        self.payment.refund(Decimal("300"))
        self.payment.refund(Decimal("200"))
        self.invoice.refresh_from_db()
        self.assertEqual(self.payment.refundable_amount(), Decimal("0"))
        self.assertEqual(self.invoice.status, Invoice.Status.UNPAID)

    def test_cannot_refund_zero_or_negative(self):
        with self.assertRaises(ValidationError):
            self.payment.refund(Decimal("0"))


class VoidTests(TestCase):
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
            unit_price=Decimal("500"),
            source_type=InvoiceLine.SourceType.MENU_ITEM,
        )
        self.invoice.recompute_totals()

    def test_can_void_an_unpaid_invoice(self):
        self.invoice.void()
        self.assertEqual(self.invoice.status, Invoice.Status.VOID)

    def test_cannot_void_an_invoice_with_money_outstanding(self):
        Payment.objects.create(
            organization=self.org, invoice=self.invoice, method=Payment.Method.CASH, amount=Decimal("500")
        )
        self.invoice.apply_payment()
        with self.assertRaises(ValidationError):
            self.invoice.void()

    def test_can_void_after_fully_refunding_a_paid_invoice(self):
        payment = Payment.objects.create(
            organization=self.org, invoice=self.invoice, method=Payment.Method.CASH, amount=Decimal("500")
        )
        self.invoice.apply_payment()
        payment.refund(Decimal("500"))
        self.invoice.refresh_from_db()
        self.invoice.void()
        self.assertEqual(self.invoice.status, Invoice.Status.VOID)
