"""DB-driven roles (Phase 2) — replaces the old fixed StoreStaff.Role enum,
which nothing actually enforced. Covers that a role's permission flags are
what actually gate the sensitive actions (refund/void, staff, settings,
menu, discounts), not just decorative fields, plus the cross-org
assignment guards on StoreStaff.
"""

from decimal import Decimal

from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role, StoreStaff, User
from billing.models import Invoice, InvoiceLine, Payment
from organizations.models import Organization, Store


def make_org(email_prefix):
    org = Organization.objects.create(
        name=f"Org {email_prefix}", slug=f"org-{email_prefix}", business_type=Organization.BusinessType.RESTAURANT
    )
    store = Store.objects.create(organization=org, store_type=Store.StoreType.RESTAURANT, name="Main")
    return org, store


def make_staff_user(org, store, email, **role_flags):
    user = User.objects.create_user(email=email, password="testpass123", organization=org)
    role = Role.objects.create(organization=org, name=f"Role for {email}", **role_flags)
    StoreStaff.objects.create(user=user, store=store, role=role)
    return user, role


class PermissionEnforcementTests(APITestCase):
    def setUp(self):
        self.org, self.store = make_org("perm")
        self.cashier, self.cashier_role = make_staff_user(self.org, self.store, "cashier@perm.test")
        self.manager, self.manager_role = make_staff_user(
            self.org, self.store, "manager@perm.test",
            can_refund_or_void=True, can_manage_menu=True, can_manage_discounts=True,
            can_view_reports=True, can_manage_staff=True, can_access_settings=True,
        )

        self.invoice = Invoice.objects.create(
            organization=self.org, store=self.store, source_type=Invoice.SourceType.ORDER
        )
        InvoiceLine.objects.create(
            organization=self.org, invoice=self.invoice, description="Item",
            quantity=1, unit_price=Decimal("500"), source_type=InvoiceLine.SourceType.MENU_ITEM,
        )
        self.invoice.recompute_totals()
        self.payment = Payment.objects.create(
            organization=self.org, invoice=self.invoice, method=Payment.Method.CASH, amount=Decimal("500")
        )
        self.invoice.apply_payment()

    def test_cashier_cannot_refund(self):
        self.client.force_authenticate(self.cashier)
        response = self.client.post(
            f"/api/invoices/{self.invoice.id}/refund/",
            {"payment_id": str(self.payment.id), "amount": "100"},
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_manager_can_refund(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            f"/api/invoices/{self.invoice.id}/refund/",
            {"payment_id": str(self.payment.id), "amount": "100"},
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_cashier_cannot_void(self):
        unpaid_invoice = Invoice.objects.create(
            organization=self.org, store=self.store, source_type=Invoice.SourceType.ORDER
        )
        self.client.force_authenticate(self.cashier)
        response = self.client.post(f"/api/invoices/{unpaid_invoice.id}/void/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_cashier_cannot_manage_menu(self):
        self.client.force_authenticate(self.cashier)
        response = self.client.post(
            "/api/menu-items/", {"store": str(self.store.id), "name": "Test Dish", "price": "100"}
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_manager_can_manage_menu(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            "/api/menu-items/", {"store": str(self.store.id), "name": "Test Dish", "price": "100"}
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_cashier_cannot_access_settings(self):
        self.client.force_authenticate(self.cashier)
        response = self.client.patch("/api/org/", {"name": "New Name"})
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_manager_can_access_settings(self):
        self.client.force_authenticate(self.manager)
        response = self.client.patch("/api/org/", {"name": "New Name"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_cashier_cannot_manage_staff(self):
        other_user = User.objects.create_user(
            email="new-hire@perm.test", password="testpass123", organization=self.org
        )
        self.client.force_authenticate(self.cashier)
        response = self.client.post(
            "/api/staff/",
            {"user": str(other_user.id), "store": str(self.store.id), "role": str(self.cashier_role.id)},
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_cashier_cannot_view_reports(self):
        self.client.force_authenticate(self.cashier)
        response = self.client.get("/api/reports/sales-daily/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_manager_can_view_reports(self):
        self.client.force_authenticate(self.manager)
        response = self.client.get("/api/reports/sales-daily/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_dashboard_summary_open_to_any_staff(self):
        """Not gated by can_view_reports — it's the landing page, not one
        of the detailed reports."""
        self.client.force_authenticate(self.cashier)
        response = self.client.get("/api/dashboard/summary/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class CrossOrgRoleAssignmentTests(APITestCase):
    def setUp(self):
        self.org_a, self.store_a = make_org("cross-a")
        self.org_b, self.store_b = make_org("cross-b")
        self.admin_a, _ = make_staff_user(
            self.org_a, self.store_a, "admin@cross-a.test", can_manage_staff=True
        )
        self.role_b = Role.objects.create(organization=self.org_b, name="Role B")

    def test_cannot_assign_a_role_from_another_org(self):
        target_user = User.objects.create_user(
            email="target@cross-a.test", password="testpass123", organization=self.org_a
        )
        self.client.force_authenticate(self.admin_a)
        response = self.client.post(
            "/api/staff/",
            {"user": str(target_user.id), "store": str(self.store_a.id), "role": str(self.role_b.id)},
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cannot_assign_staff_to_another_orgs_store(self):
        """admin_a has can_manage_staff=True, but only at store_a — since
        they have no assignment at all on store_b, the permission check
        (scoped to store_b) fails first and this 403s before ever reaching
        the cross-org validation. Either rejection is fine; this asserts
        the row is never created."""
        target_user = User.objects.create_user(
            email="target2@cross-a.test", password="testpass123", organization=self.org_a
        )
        role_a = Role.objects.create(organization=self.org_a, name="Role A")
        self.client.force_authenticate(self.admin_a)
        response = self.client.post(
            "/api/staff/",
            {"user": str(target_user.id), "store": str(self.store_b.id), "role": str(role_a.id)},
        )
        self.assertIn(response.status_code, (status.HTTP_400_BAD_REQUEST, status.HTTP_403_FORBIDDEN))
        self.assertFalse(StoreStaff.objects.filter(user=target_user).exists())
