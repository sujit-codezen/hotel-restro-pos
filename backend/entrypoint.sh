#!/bin/sh
set -e

# Run once per container start regardless of which process this is (web,
# celery-worker, celery-beat all share this image) — migrate is idempotent
# and cheap, and every process needs the schema/static files current.
python manage.py migrate --noinput
python manage.py collectstatic --noinput

# Row-level security (core.migrations.0001_enable_rls) is opt-in hardening:
# it only has an effect for a connection that isn't the tables' owner, so
# it needs the restricted app_runtime role provisioned first. Skipped, not
# fatal, when RLS_RUNTIME_DB_PASSWORD isn't configured — see docs/rls.md.
if [ -n "$RLS_RUNTIME_DB_PASSWORD" ]; then
  python manage.py setup_rls
fi

# Everything above (migrate/collectstatic/setup_rls) runs with this
# container's normal DB_USER — the table owner, needed for schema changes
# and to create app_runtime in the first place. The process being started
# below is what actually serves traffic, so *it* is what should connect
# as the restricted role once one is configured — overriding DB_USER/
# DB_PASSWORD only for this exec, not the steps above. Falls back to the
# unrestricted connection (today's behavior) when RUNTIME_DB_USER isn't
# set, so this is a no-op until an operator opts in.
if [ -n "$RUNTIME_DB_USER" ]; then
  export DB_USER="$RUNTIME_DB_USER"
  export DB_PASSWORD="$RUNTIME_DB_PASSWORD"
fi

exec "$@"
