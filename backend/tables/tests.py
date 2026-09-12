"""Table.slug — auto-generated, unique per store — and the (store, name)
uniqueness the "unique table name" requirement is actually enforced by.
"""

from rest_framework.test import APITestCase

from accounts.models import User
from organizations.models import Organization, Store
from tables.models import Table


def make_org_store(slug_suffix=""):
    org = Organization.objects.create(
        name=f"Table Test Org{slug_suffix}",
        slug=f"table-test-org{slug_suffix}",
        business_type=Organization.BusinessType.RESTAURANT,
    )
    store = Store.objects.create(organization=org, store_type=Store.StoreType.RESTAURANT, name="Main")
    return org, store


class TableSlugTests(APITestCase):
    def setUp(self):
        self.org, self.store = make_org_store()
        self.user = User.objects.create_user(
            email="owner@tabletest.test", password="testpass123", organization=self.org
        )
        self.client.force_authenticate(self.user)

    def test_slug_auto_generated_from_name(self):
        table = Table.objects.create(organization=self.org, store=self.store, name="Patio Table 1")
        self.assertEqual(table.slug, "patio-table-1")

    def test_slug_deduplicated_within_store(self):
        Table.objects.create(organization=self.org, store=self.store, name="T-01")
        # Different name, same slugified base — must not collide.
        second = Table.objects.create(organization=self.org, store=self.store, name="T 01")
        self.assertEqual(second.slug, "t-01-2")

    def test_same_name_allowed_in_different_stores(self):
        other_org, other_store = make_org_store("-2")
        Table.objects.create(organization=self.org, store=self.store, name="T01")
        # Different org/store entirely — no cross-tenant collision.
        table = Table.objects.create(organization=other_org, store=other_store, name="T01")
        self.assertEqual(table.slug, "t01")

    def test_api_rejects_duplicate_name_in_same_store(self):
        response = self.client.post(
            "/api/tables/", {"store": str(self.store.id), "name": "T01", "capacity": 4}
        )
        self.assertEqual(response.status_code, 201)

        response = self.client.post(
            "/api/tables/", {"store": str(self.store.id), "name": "T01", "capacity": 2}
        )
        self.assertEqual(response.status_code, 400)

    def test_api_response_includes_generated_slug(self):
        response = self.client.post(
            "/api/tables/", {"store": str(self.store.id), "name": "Rooftop 5", "capacity": 6}
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["slug"], "rooftop-5")


class TableEditDeleteTests(APITestCase):
    def setUp(self):
        self.org, self.store = make_org_store()
        self.user = User.objects.create_user(
            email="owner@tableedit.test", password="testpass123", organization=self.org
        )
        self.client.force_authenticate(self.user)
        self.table = Table.objects.create(
            organization=self.org, store=self.store, name="T01", capacity=4
        )

    def test_can_edit_name_capacity_and_shape(self):
        response = self.client.patch(
            f"/api/tables/{self.table.id}/",
            {"name": "T01-Patio", "capacity": 6, "shape": "round"},
        )
        self.assertEqual(response.status_code, 200)
        self.table.refresh_from_db()
        self.assertEqual(self.table.name, "T01-Patio")
        self.assertEqual(self.table.capacity, 6)
        self.assertEqual(self.table.shape, "round")

    def test_renaming_to_same_name_is_not_a_conflict(self):
        response = self.client.patch(f"/api/tables/{self.table.id}/", {"name": "T01"})
        self.assertEqual(response.status_code, 200)

    def test_renaming_to_another_tables_name_is_rejected(self):
        Table.objects.create(organization=self.org, store=self.store, name="T02")
        response = self.client.patch(f"/api/tables/{self.table.id}/", {"name": "T02"})
        self.assertEqual(response.status_code, 400)

    def test_can_delete_an_available_table(self):
        response = self.client.delete(f"/api/tables/{self.table.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Table.objects.filter(id=self.table.id).exists())

    def test_cannot_delete_an_occupied_table(self):
        self.table.status = Table.Status.OCCUPIED
        self.table.save(update_fields=["status"])

        response = self.client.delete(f"/api/tables/{self.table.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertTrue(Table.objects.filter(id=self.table.id).exists())
