"""Parametrized tenant-isolation backstop, per the plan's Phase 1
verification section: asserts org A's token can never read or write org
B's rows through any ViewSet built on OrgScopedViewSetMixin, including by
guessing an object's UUID directly.
"""

from decimal import Decimal

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from billing.models import Invoice
from catalog.models import MenuItem
from customers.models import Customer
from hotel.models import Room, RoomType
from organizations.models import Organization, Store
from tables.models import Table


def make_org_with_user(email, business_type=Organization.BusinessType.RESTAURANT):
    org = Organization.objects.create(
        name=f"Org for {email}", slug=email.split("@")[0], business_type=business_type
    )
    store = Store.objects.create(
        organization=org, store_type=Store.StoreType.RESTAURANT, name="Main"
    )
    user = User.objects.create_user(email=email, password="testpass123", organization=org)
    return org, store, user


class TenantIsolationTests(APITestCase):
    def setUp(self):
        self.org_a, self.store_a, self.user_a = make_org_with_user("a@isolation.test")
        self.org_b, self.store_b, self.user_b = make_org_with_user("b@isolation.test")

        # A row that belongs to org B, that org A must never see or touch.
        self.menu_item_b = MenuItem.objects.create(
            organization=self.org_b, store=self.store_b, name="Secret Dish", price=Decimal("10")
        )
        self.table_b = Table.objects.create(
            organization=self.org_b, store=self.store_b, name="B-T1"
        )
        self.customer_b = Customer.objects.create(
            organization=self.org_b, phone="000", name="B Customer"
        )
        room_type_b = RoomType.objects.create(
            organization=self.org_b, store=self.store_b, name="B Room", base_rate=Decimal("100")
        )
        self.room_b = Room.objects.create(
            organization=self.org_b, store=self.store_b, room_type=room_type_b, number="B1"
        )

        self.client.force_authenticate(self.user_a)

    def test_list_endpoints_never_include_other_org_rows(self):
        cases = [
            ("menu-item-list", self.menu_item_b.id),
            ("table-list", self.table_b.id),
            ("customer-list", self.customer_b.id),
            ("room-list", self.room_b.id),
        ]
        for url_name, other_org_id in cases:
            with self.subTest(url_name=url_name):
                response = self.client.get(reverse(url_name))
                self.assertEqual(response.status_code, status.HTTP_200_OK)
                returned_ids = {row["id"] for row in response.data["results"]}
                self.assertNotIn(str(other_org_id), returned_ids)

    def test_retrieve_by_guessed_id_returns_404_not_other_org_data(self):
        cases = [
            ("menu-item-detail", self.menu_item_b.id),
            ("table-detail", self.table_b.id),
            ("customer-detail", self.customer_b.id),
            ("room-detail", self.room_b.id),
        ]
        for url_name, other_org_id in cases:
            with self.subTest(url_name=url_name):
                response = self.client.get(reverse(url_name, args=[other_org_id]))
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_create_ignores_client_supplied_organization(self):
        """perform_create() must force organization=request.org even if the
        client tries to smuggle a different one in the payload."""
        response = self.client.post(
            reverse("table-list"),
            {"store": str(self.store_a.id), "name": "Smuggled", "organization": str(self.org_b.id)},
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        table = Table.objects.get(id=response.data["id"])
        self.assertEqual(table.organization_id, self.org_a.id)

    def test_cannot_write_to_other_orgs_store(self):
        """A create pointed at org B's `store` must be rejected outright —
        otherwise organization=request.org would still get force-set onto a
        row whose store FK points at another org, corrupting the data."""
        response = self.client.post(
            reverse("table-list"), {"store": str(self.store_b.id), "name": "Cross-org"}
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Table.objects.filter(name="Cross-org").exists())

    def test_invoice_viewset_isolated(self):
        invoice_b = Invoice.objects.create(
            organization=self.org_b, store=self.store_b, source_type=Invoice.SourceType.ORDER
        )
        response = self.client.get(reverse("invoice-detail", args=[invoice_b.id]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_unauthenticated_request_rejected(self):
        self.client.force_authenticate(None)
        response = self.client.get(reverse("table-list"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
