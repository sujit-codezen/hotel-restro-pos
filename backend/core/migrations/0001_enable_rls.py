"""Enables Postgres row-level security on every tenant table, as
defense-in-depth behind the application-level tenant scoping
(OrgScopedViewSetMixin + the parametrized isolation test suite, which stay
the primary enforcement — this is a second, independent layer in case a
future ViewSet forgets to filter).

RLS only has an effect for a DB connection that is neither the tables'
owner nor a superuser — see core.management.commands.setup_rls, which
provisions that restricted role. Local dev and `manage.py test` keep
connecting as the Postgres superuser by default (fast, unrestricted, as
today); only a deployment that switches the *serving* process to the
restricted role actually gets RLS enforcement. See docs/rls.md.

Every policy is the same shape: a row is visible/writable when its
organization_id matches the session's app.current_org_id (set by
core.permissions.set_tenant_context, called from IsOrgMember and from
onboarding), OR when app.is_platform_admin is set (Django admin
superusers, via core.middleware.TenantRLSMiddleware). Both
current_setting() calls use the missing_ok flag so a session that never
set them gets NULL/false rather than an error — i.e. fails closed.
"""

from django.db import migrations

TENANT_TABLES = [
    "accounts_role",
    "billing_discount",
    "billing_invoice",
    "billing_invoicecounter",
    "billing_invoiceline",
    "billing_payment",
    "billing_refund",
    "catalog_menucategory",
    "catalog_menuitem",
    "catalog_menuitemmodifiergroup",
    "catalog_modifier",
    "catalog_modifiergroup",
    "catalog_taxclass",
    "customers_customer",
    "hotel_folio",
    "hotel_folioline",
    "hotel_gueststay",
    "hotel_reservation",
    "hotel_room",
    "hotel_roomtype",
    "orders_kitchenticket",
    "orders_kitchenticketitem",
    "orders_order",
    "orders_orderitem",
    "orders_orderitemmodifier",
    "organizations_store",
    "tables_table",
]

POLICY_EXPR = (
    "organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid"
    " OR current_setting('app.is_platform_admin', true) = 'true'"
)


def enable_rls(table):
    return (
        f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;\n"
        f"DROP POLICY IF EXISTS tenant_isolation ON {table};\n"
        f"CREATE POLICY tenant_isolation ON {table}\n"
        f"    USING ({POLICY_EXPR})\n"
        f"    WITH CHECK ({POLICY_EXPR});\n"
    )


def disable_rls(table):
    return (
        f"DROP POLICY IF EXISTS tenant_isolation ON {table};\n"
        f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;\n"
    )


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("accounts", "0007_finalize_role_field"),
        ("billing", "0007_invoice_discount"),
        ("catalog", "0003_menuitem_image"),
        ("customers", "0002_alter_customer_options"),
        ("hotel", "0003_alter_room_options"),
        ("orders", "0003_orderitem_invoice"),
        ("organizations", "0001_initial"),
        ("tables", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(
            sql="\n".join(enable_rls(t) for t in TENANT_TABLES),
            reverse_sql="\n".join(disable_rls(t) for t in TENANT_TABLES),
        ),
    ]
