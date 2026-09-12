# Org resolution lives in core.permissions.resolve_org(), called from
# IsOrgMember, instead of Django middleware: with JWTAuthentication,
# request.user isn't populated until DRF authenticates inside the view,
# which runs after Django's middleware stack has already finished.

from django.db import connection


class TenantRLSMiddleware:
    """Two jobs for the RLS session context (core.migrations.0001_enable_rls):

    1. Grants the platform-admin RLS bypass to Django-admin superusers.
       Unlike the DRF/JWT API, /admin/ uses session auth that
       AuthenticationMiddleware has already resolved by the time
       middleware runs, so (unlike IsOrgMember) this can safely read
       request.user here — must be placed after AuthenticationMiddleware
       in MIDDLEWARE for that to hold.
    2. Resets both session variables after every response, so a reused
       per-thread DB connection (CONN_MAX_AGE > 0) never carries one
       request's org/admin context into the next. With the default
       CONN_MAX_AGE=0 each request gets a fresh connection anyway, making
       this a no-op belt-and-suspenders in that case — cheap insurance
       either way, not load-bearing for correctness under the default.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith("/admin/") and getattr(request.user, "is_superuser", False):
            with connection.cursor() as cursor:
                cursor.execute("SELECT set_config('app.is_platform_admin', 'true', false)")

        response = self.get_response(request)

        if connection.connection is not None:
            with connection.cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_org_id', '', false)")
                cursor.execute("SELECT set_config('app.is_platform_admin', '', false)")

        return response
