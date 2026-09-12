from django.db import connection
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission


def set_tenant_context(organization_id):
    """Sets the Postgres session variable the RLS policies in
    core.migrations.0001_enable_rls check (`app.current_org_id`) — a
    second, independent enforcement layer behind the application-level
    org filtering. Only has any effect for a DB connection that isn't the
    tables' owner/a superuser (see setup_rls); local dev's default
    superuser connection bypasses RLS regardless, so this is a no-op
    there, which is intentional (see docs/rls.md).

    Uses set_config() rather than a `SET` statement so the value can be
    parameterized (SET doesn't support bind params); is_local=false makes
    it session-scoped rather than transaction-scoped, so it survives past
    a `transaction.atomic()` block finishing — necessary here since
    onboarding sets this mid-transaction, before creating a Store, and it
    must still be in effect afterwards when seed_default_roles() runs
    outside that block."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT set_config('app.current_org_id', %s, false)", [str(organization_id)])


def resolve_org(request):
    """Sets request.org from the authenticated user's organization.

    Must run from a DRF permission class (or later), not Django middleware:
    with JWTAuthentication, request.user isn't populated until DRF's
    perform_authentication() runs inside the view, which happens after
    Django's own middleware stack has already finished.
    """
    if getattr(request, "org", None):
        return request.org
    user = getattr(request, "user", None)
    org = getattr(user, "organization", None) if user and user.is_authenticated else None
    request.org = org
    return org


class IsOrgMember(BasePermission):
    """Blocks any request from a user without a resolved organization
    (e.g. platform staff, or a user who hasn't completed onboarding)."""

    def has_permission(self, request, view):
        org = resolve_org(request)
        if not (request.user and request.user.is_authenticated and org):
            return False
        set_tenant_context(org.id)
        return True


def user_has_permission(user, flag_name, store=None):
    """True if some active StoreStaff assignment for `user` grants
    `flag_name` on its Role — scoped to `store` if given, otherwise any
    store in the user's organization (for actions that aren't tied to one
    store, like org settings or a Discount, which has no store field)."""
    assignments = user.store_assignments.filter(is_active=True).select_related("role")
    if store is not None:
        assignments = assignments.filter(store=store)
    return any(getattr(a.role, flag_name, False) for a in assignments)


def require_permission(request, flag_name, store=None):
    """Raises PermissionDenied (DRF 403) unless the requesting user has
    `flag_name` — see user_has_permission(). Call this inline at the top
    of a view/action, the same pattern as InvoiceViewSet's inline staff
    lookup, rather than a separate permission_classes entry: most of these
    checks only apply to specific actions (refund/void, not read) on a
    ViewSet that's otherwise open to any org member."""
    if not user_has_permission(request.user, flag_name, store=store):
        raise PermissionDenied(f"Your role does not have the '{flag_name}' permission.")
