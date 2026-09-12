from django.db import migrations

# Frozen copy of accounts.services.DEFAULT_ROLES at migration time — data
# migrations must not import app code, since that code can change shape
# later while this migration still needs to run exactly as written.
DEFAULT_ROLE_FLAGS = {
    "Owner": dict(
        can_refund_or_void=True, can_manage_staff=True, can_access_settings=True,
        can_manage_menu=True, can_manage_discounts=True, can_view_reports=True,
    ),
    "Admin": dict(
        can_refund_or_void=True, can_manage_staff=True, can_access_settings=True,
        can_manage_menu=True, can_manage_discounts=True, can_view_reports=True,
    ),
    "Manager": dict(
        can_refund_or_void=True, can_manage_staff=False, can_access_settings=False,
        can_manage_menu=True, can_manage_discounts=True, can_view_reports=True,
    ),
    "Cashier": dict(),
    "Waiter": dict(),
    "Kitchen": dict(),
    "Front Desk": dict(),
}

# Old StoreStaff.Role enum value -> new Role.name.
OLD_VALUE_TO_NAME = {
    "OWNER": "Owner",
    "ADMIN": "Admin",
    "MANAGER": "Manager",
    "CASHIER": "Cashier",
    "WAITER": "Waiter",
    "KITCHEN": "Kitchen",
    "FRONT_DESK": "Front Desk",
}


def migrate_roles(apps, schema_editor):
    Role = apps.get_model("accounts", "Role")
    StoreStaff = apps.get_model("accounts", "StoreStaff")

    # store.organization_id, not user.organization_id — the store a
    # StoreStaff row actually belongs to is the authoritative org for that
    # assignment, and is what Role.organization needs to match.
    org_ids_with_staff = set(
        StoreStaff.objects.values_list("store__organization_id", flat=True).distinct()
    )
    roles_by_org = {}
    for org_id in org_ids_with_staff:
        roles_by_org[org_id] = {}
        for name, flags in DEFAULT_ROLE_FLAGS.items():
            role, _ = Role.objects.get_or_create(
                organization_id=org_id, name=name, defaults={"is_system": True, **flags}
            )
            roles_by_org[org_id][name] = role

    for staff in StoreStaff.objects.select_related("store"):
        org_id = staff.store.organization_id
        role_name = OLD_VALUE_TO_NAME.get(staff.role_legacy, "Cashier")
        staff.role = roles_by_org[org_id][role_name]
        staff.save(update_fields=["role"])


def noop_reverse(apps, schema_editor):
    # role_legacy still holds the original value; nothing to undo beyond
    # what removing the Role rows (handled by migrating backward through
    # 0003) already does.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0005_storestaff_role_fk"),
    ]

    operations = [
        migrations.RunPython(migrate_roles, noop_reverse),
    ]
