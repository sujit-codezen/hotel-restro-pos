from accounts.models import Role

# Name -> permission flags. Matches the old fixed StoreStaff.Role enum's
# names 1:1 (so nothing else has to change), but is now just a starting
# point — these rows are ordinary Role records an org admin can edit,
# rename, or delete once at least one other role exists to fall back to.
DEFAULT_ROLES = {
    "Owner": dict(
        can_refund_or_void=True,
        can_manage_staff=True,
        can_access_settings=True,
        can_manage_menu=True,
        can_manage_discounts=True,
        can_view_reports=True,
    ),
    "Admin": dict(
        can_refund_or_void=True,
        can_manage_staff=True,
        can_access_settings=True,
        can_manage_menu=True,
        can_manage_discounts=True,
        can_view_reports=True,
    ),
    "Manager": dict(
        can_refund_or_void=True,
        can_manage_staff=False,
        can_access_settings=False,
        can_manage_menu=True,
        can_manage_discounts=True,
        can_view_reports=True,
    ),
    "Cashier": dict(),
    "Waiter": dict(),
    "Kitchen": dict(),
    "Front Desk": dict(),
}


def seed_default_roles(organization):
    """Creates the standard role set for a newly onboarded organization.
    Idempotent by (organization, name) — safe to call again without
    duplicating rows a re-run (or a future "restore defaults" action)
    might trigger."""
    roles = {}
    for name, flags in DEFAULT_ROLES.items():
        role, _ = Role.objects.get_or_create(
            organization=organization, name=name, defaults={"is_system": True, **flags}
        )
        roles[name] = role
    return roles
