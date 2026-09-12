"""Proves the Postgres row-level security policies from
core.migrations.0001_enable_rls actually enforce isolation — not just
that the migration applies cleanly. None of the application-level tests
(including test_tenant_isolation.py) catch an RLS bug, since they all run
through Django's default connection, which is the tables' owner and
therefore bypasses RLS entirely regardless of policy correctness. This
test connects as the restricted app_runtime role instead, the same way a
deployment enforcing RLS would (see core.management.commands.setup_rls),
and talks to Postgres directly rather than through the Django ORM.

TransactionTestCase (not TestCase) is required: the app_runtime
connection is a second, separate DB connection, which can only see
committed data — TestCase's per-test rollback would leave it blind.
"""

import os

import psycopg2
from django.core.management import call_command
from django.db import connection
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from accounts.models import User
from billing.models import Discount
from organizations.models import Organization, Store

RUNTIME_PASSWORD = "test_runtime_password_not_for_prod"


class RLSEnforcementTests(TransactionTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        os.environ["RLS_RUNTIME_DB_PASSWORD"] = RUNTIME_PASSWORD
        call_command("setup_rls")

    def setUp(self):
        self.org_a = Organization.objects.create(
            name="RLS Org A", slug="rls-org-a", business_type=Organization.BusinessType.RESTAURANT
        )
        self.org_b = Organization.objects.create(
            name="RLS Org B", slug="rls-org-b", business_type=Organization.BusinessType.RESTAURANT
        )
        Store.objects.create(organization=self.org_a, store_type=Store.StoreType.RESTAURANT, name="A Store")
        Store.objects.create(organization=self.org_b, store_type=Store.StoreType.RESTAURANT, name="B Store")
        Discount.objects.create(organization=self.org_a, name="A Discount", type=Discount.Type.PERCENT, value=10)
        Discount.objects.create(organization=self.org_b, name="B Discount", type=Discount.Type.PERCENT, value=10)

        settings = connection.settings_dict
        self.conn = psycopg2.connect(
            dbname=settings["NAME"],
            user="app_runtime",
            password=RUNTIME_PASSWORD,
            host=settings["HOST"] or "localhost",
            port=settings["PORT"] or "5432",
        )
        self.conn.autocommit = True

    def tearDown(self):
        self.conn.close()

    def _count(self, table, org_id=None, platform_admin=False):
        with self.conn.cursor() as cur:
            cur.execute("SELECT set_config('app.current_org_id', %s, false)", [str(org_id or "")])
            cur.execute("SELECT set_config('app.is_platform_admin', %s, false)", ["true" if platform_admin else ""])
            cur.execute(f"SELECT count(*) FROM {table}")
            return cur.fetchone()[0]

    def test_no_context_sees_nothing(self):
        self.assertEqual(self._count("organizations_store"), 0)
        self.assertEqual(self._count("billing_discount"), 0)

    def test_each_org_sees_only_its_own_rows(self):
        self.assertEqual(self._count("organizations_store", org_id=self.org_a.id), 1)
        self.assertEqual(self._count("organizations_store", org_id=self.org_b.id), 1)
        self.assertEqual(self._count("billing_discount", org_id=self.org_a.id), 1)
        self.assertEqual(self._count("billing_discount", org_id=self.org_b.id), 1)

    def test_cannot_write_a_row_stamped_with_another_orgs_id(self):
        with self.conn.cursor() as cur:
            cur.execute("SELECT set_config('app.current_org_id', %s, false)", [str(self.org_a.id)])
            with self.assertRaises(psycopg2.errors.InsufficientPrivilege):
                cur.execute(
                    "INSERT INTO billing_discount "
                    "(id, organization_id, name, type, value, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), %s, 'Sneaky', 'PERCENT', 5, now(), now())",
                    [str(self.org_b.id)],
                )

    def test_platform_admin_bypasses_isolation(self):
        self.assertEqual(self._count("organizations_store", platform_admin=True), 2)
        self.assertEqual(self._count("billing_discount", platform_admin=True), 2)

    def test_user_table_has_no_rls_since_auth_must_work_before_org_is_known(self):
        """accounts_user isn't in the RLS table list — see
        core.migrations.0001_enable_rls's docstring: JWT authentication
        reads the User row before request.org (and therefore the RLS
        session context) exists, so RLS on that table would break login
        outright."""
        User.objects.create_user(email="rls-user@test.test", password="x", organization=self.org_a)
        self.assertEqual(self._count("accounts_user"), 1)


class OnboardingUnderRLSTests(TransactionTestCase):
    """Onboarding is the one write path with no request.org yet — the
    Organization it creates *is* the org, so nothing has called
    set_tenant_context() before OnboardingSerializer.create() does it
    manually (organizations/serializers.py). This runs the real
    OnboardingView over the real app_runtime connection to prove that
    fix actually satisfies the Store insert's RLS WITH CHECK, rather than
    just reading the code and assuming it does."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        os.environ["RLS_RUNTIME_DB_PASSWORD"] = RUNTIME_PASSWORD
        call_command("setup_rls")

    def setUp(self):
        self._original_user = connection.settings_dict["USER"]
        self._original_password = connection.settings_dict["PASSWORD"]
        connection.close()
        connection.settings_dict["USER"] = "app_runtime"
        connection.settings_dict["PASSWORD"] = RUNTIME_PASSWORD

    def tearDown(self):
        connection.close()
        connection.settings_dict["USER"] = self._original_user
        connection.settings_dict["PASSWORD"] = self._original_password

    def test_onboarding_creates_org_and_store_under_rls(self):
        user = User.objects.create_user(email="new-owner@rls.test", password="testpass123")
        client = APIClient()
        client.force_authenticate(user)

        response = client.post(
            "/api/org/onboarding/", {"name": "New RLS Org", "business_type": "RESTAURANT"}
        )
        self.assertEqual(response.status_code, 201)

        # TenantRLSMiddleware already reset app.current_org_id after that
        # response (see core/middleware.py) — same as a real follow-up
        # request would, IsOrgMember sets it again before reading back
        # what onboarding just wrote.
        org_id = response.data["id"]
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_org_id', %s, false)", [org_id])
        self.assertEqual(Store.objects.filter(organization_id=org_id).count(), 1)
        user.refresh_from_db()
        self.assertEqual(str(user.organization_id), org_id)
