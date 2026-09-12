# Postgres row-level security (defense-in-depth)

Tenant isolation is enforced primarily at the application layer:
`OrgScopedViewSetMixin` filters every queryset to `request.org` and forces
`organization=request.org` on create, and
`core/tests/test_tenant_isolation.py` is a parametrized regression test
asserting org A can never read or write org B's rows through any ViewSet.
That stays the primary defense — it's what catches a bug in review or CI.

Row-level security is a *second, independent* layer underneath it, so a
future ViewSet that forgets to filter still can't leak data: the database
itself refuses the row.

## Why it doesn't do anything by default

Postgres RLS has no effect on a connection that is the table's **owner**
or a **superuser** — both bypass RLS unconditionally, regardless of how
correct the policy is. Every default connection in this project (local
dev, `manage.py test`, migrations) connects as that owner/superuser, on
purpose — it would be needlessly slow and restrictive to fight RLS during
normal development. So: the migration that enables RLS
(`core/migrations/0001_enable_rls.py`) always applies, but only actually
*enforces* anything for a connection using the restricted `app_runtime`
role.

## How a deployment opts in

1. Set `RLS_RUNTIME_DB_PASSWORD` (and `RUNTIME_DB_USER=app_runtime`) in
   the environment. `docker-compose.prod.yml`'s `backend` service reads
   these; `celery-worker`/`celery-beat` deliberately don't (see below).
2. `backend/entrypoint.sh` runs `manage.py setup_rls` after migrating —
   idempotent, creates/updates the `app_runtime` role and grants it
   everything it needs (all tables/sequences, plus default privileges so
   future migrations' new tables are covered automatically).
3. The same entrypoint then execs the actual server process (Daphne) with
   `DB_USER`/`DB_PASSWORD` overridden to the restricted role — but *only*
   for that final exec, not for the `migrate`/`setup_rls` steps that ran
   just before it, which still need owner privileges.

Nothing above changes local dev or CI: `RUNTIME_DB_USER` stays unset
there, so the entrypoint's override is a no-op and everything keeps
connecting as the superuser, same as before this feature existed.

## What's actually gated

Every model extending `core.models.BaseTenantModel` (an `organization`
FK is the tenant key), plus `organizations.Store` (tenant data, but not
itself a `BaseTenantModel` subclass since it *is* the root of a store,
not owned by one) — see the `TENANT_TABLES` list in
`core/migrations/0001_enable_rls.py`.

**Not** gated: `accounts.User` and `accounts.StoreStaff`. JWT
authentication reads the `User` row to populate `request.user` before
`request.org` (and therefore the RLS session context) can possibly exist
— RLS on that table would break login outright. `StoreStaff` has no
`organization` column of its own (only via `store`/`user`), so it isn't a
`BaseTenantModel` in the first place.

## The session context

Each policy checks a Postgres session variable:

```sql
organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    OR current_setting('app.is_platform_admin', true) = 'true'
```

`current_setting(..., true)` returns `NULL` instead of raising when the
variable was never set — so an unconfigured session sees **zero rows**,
not an error. Fails closed.

- `core.permissions.set_tenant_context(organization_id)` sets
  `app.current_org_id`. Called from `IsOrgMember.has_permission()` — the
  permission class nearly every ViewSet uses — right after it resolves
  `request.org`, so it runs before any queryset for that request executes.
- **Onboarding is the one exception**: the Organization being created *is*
  the org, so nothing has resolved `request.org` yet when the first
  `Store` row is inserted. `OnboardingSerializer.create()`
  (`organizations/serializers.py`) calls `set_tenant_context()` manually,
  immediately after creating the `Organization` and before creating its
  `Store`(s) — see `core/tests/test_rls.py::OnboardingUnderRLSTests` for
  the end-to-end proof this actually works under the restricted role.
- `app.is_platform_admin` is set by `core.middleware.TenantRLSMiddleware`
  for Django-admin superusers (session auth is already resolved by
  `AuthenticationMiddleware` at that point, unlike DRF's lazy JWT auth) —
  so a platform operator debugging via `/admin/` can still see everything.
- The same middleware resets both variables after every response, as
  insurance against a reused per-thread connection (`CONN_MAX_AGE > 0`)
  carrying one request's context into the next. With the project's
  default `CONN_MAX_AGE=0`, each request gets a fresh connection anyway,
  making this a no-op in practice today.

## Verifying it

`core/tests/test_rls.py` connects directly to Postgres as `app_runtime`
(bypassing the Django ORM's connection, which is always the superuser)
and proves: no context sees nothing, each org sees only its own rows, a
write stamped with another org's id is rejected, the platform-admin flag
bypasses isolation, and `accounts_user` is intentionally left ungated.
None of the application-level tests would catch a broken policy, since
they all run through the superuser connection and bypass RLS regardless
of whether the policy is right — this is the one place that isn't true.

## Known gap

Celery tasks (none exist yet) and management commands other than
`setup_rls` still connect as the owner/superuser — nothing sets a
per-tenant RLS context for a background job. When a task like the
plan's "nightly report pre-aggregation" is built, it'll need to either
call `set_tenant_context()` per org it processes, or run with the
platform-admin bypass if it's inherently cross-tenant.
