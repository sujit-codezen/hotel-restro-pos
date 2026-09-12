"""Multi-property reporting rollup (Phase 2). Every other report endpoint
silently combines all of an org's stores under `organization=request.org`;
PropertyPerformanceReportView is the one place that breaks that back out
per store, so it's the one worth testing directly rather than relying on
the generic permission-gating tests elsewhere."""

from decimal import Decimal

from rest_framework.test import APITestCase

from accounts.models import Role, StoreStaff, User
from billing.models import Invoice, InvoiceLine, Payment
from organizations.models import Organization, Store


def make_invoice(org, store, total, quantity=1):
    invoice = Invoice.objects.create(
        organization=org, store=store, source_type=Invoice.SourceType.ORDER
    )
    InvoiceLine.objects.create(
        organization=org,
        invoice=invoice,
        description="Item",
        quantity=quantity,
        unit_price=Decimal(total) / quantity,
        source_type=InvoiceLine.SourceType.MENU_ITEM,
    )
    invoice.recompute_totals()
    invoice.finalize()
    Payment.objects.create(
        organization=org, invoice=invoice, method=Payment.Method.CASH, amount=invoice.grand_total
    )
    invoice.status = invoice._status_from_payments()
    invoice.save(update_fields=["status"])
    return invoice


class PropertyPerformanceReportTests(APITestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Multi Branch", slug="multi-branch", business_type=Organization.BusinessType.RESTAURANT
        )
        self.store_a = Store.objects.create(
            organization=self.org, store_type=Store.StoreType.RESTAURANT, name="Branch A"
        )
        self.store_b = Store.objects.create(
            organization=self.org, store_type=Store.StoreType.RESTAURANT, name="Branch B"
        )

        self.role = Role.objects.create(
            organization=self.org, name="Owner", can_view_reports=True
        )
        self.owner = User.objects.create_user(
            email="owner@multi.test", password="testpass123", organization=self.org
        )
        StoreStaff.objects.create(user=self.owner, store=self.store_a, role=self.role)
        StoreStaff.objects.create(user=self.owner, store=self.store_b, role=self.role)

        self.client.force_authenticate(self.owner)

    def test_breaks_totals_down_per_store(self):
        make_invoice(self.org, self.store_a, "1000", quantity=2)
        make_invoice(self.org, self.store_a, "500", quantity=1)
        make_invoice(self.org, self.store_b, "300", quantity=1)

        response = self.client.get("/api/reports/by-property/")
        self.assertEqual(response.status_code, 200)

        by_store = {row["store_id"]: row for row in response.data}

        row_a = by_store[self.store_a.id]
        self.assertEqual(row_a["total_sales"], Decimal("1500.00"))
        self.assertEqual(row_a["order_count"], 2)
        self.assertEqual(row_a["items_sold"], 3)

        row_b = by_store[self.store_b.id]
        self.assertEqual(row_b["total_sales"], Decimal("300.00"))
        self.assertEqual(row_b["order_count"], 1)
        self.assertEqual(row_b["items_sold"], 1)

    def test_ordered_by_total_sales_descending(self):
        make_invoice(self.org, self.store_b, "5000", quantity=1)
        make_invoice(self.org, self.store_a, "100", quantity=1)

        response = self.client.get("/api/reports/by-property/")
        self.assertEqual(response.data[0]["store_id"], self.store_b.id)
        self.assertEqual(response.data[1]["store_id"], self.store_a.id)

    def test_store_with_no_sales_is_omitted(self):
        make_invoice(self.org, self.store_a, "100", quantity=1)

        response = self.client.get("/api/reports/by-property/")
        store_ids = {row["store_id"] for row in response.data}
        self.assertIn(self.store_a.id, store_ids)
        self.assertNotIn(self.store_b.id, store_ids)

    def test_gated_by_can_view_reports(self):
        cashier_role = Role.objects.create(
            organization=self.org, name="Cashier", can_view_reports=False
        )
        cashier = User.objects.create_user(
            email="cashier@multi.test", password="testpass123", organization=self.org
        )
        StoreStaff.objects.create(user=cashier, store=self.store_a, role=cashier_role)

        self.client.force_authenticate(cashier)
        response = self.client.get("/api/reports/by-property/")
        self.assertEqual(response.status_code, 403)
