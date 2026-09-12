"""Provisions the restricted Postgres role the running server should
connect as for row-level security (core.migrations.0001_enable_rls) to
actually take effect — RLS policies have no effect on a connection that
owns the tables or is a superuser, which is what every default local/dev
connection in this project is (see docs/rls.md). Idempotent: safe to
re-run after every deploy (e.g. right after `manage.py migrate`), which is
also how it picks up tables added by later migrations.

Requires RLS_RUNTIME_DB_PASSWORD in the environment — deliberately no
default, since this sets a real role's login password.
"""

from decouple import config
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

RUNTIME_ROLE = "app_runtime"


class Command(BaseCommand):
    help = "Creates/updates the restricted app_runtime DB role RLS enforcement requires."

    def handle(self, *args, **options):
        password = config("RLS_RUNTIME_DB_PASSWORD", default=None)
        if not password:
            raise CommandError(
                "RLS_RUNTIME_DB_PASSWORD is not set — refusing to create/update the "
                f"'{RUNTIME_ROLE}' role's password. Set it in the environment and retry."
            )

        db_name = settings.DATABASES["default"]["NAME"]

        with connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", [RUNTIME_ROLE])
            exists = cursor.fetchone() is not None

            if exists:
                cursor.execute(
                    f"ALTER ROLE {RUNTIME_ROLE} WITH LOGIN NOSUPERUSER NOCREATEDB "
                    f"NOCREATEROLE NOBYPASSRLS PASSWORD %s",
                    [password],
                )
                self.stdout.write(f"Updated existing role '{RUNTIME_ROLE}'.")
            else:
                cursor.execute(
                    f"CREATE ROLE {RUNTIME_ROLE} WITH LOGIN NOSUPERUSER NOCREATEDB "
                    f"NOCREATEROLE NOBYPASSRLS PASSWORD %s",
                    [password],
                )
                self.stdout.write(f"Created role '{RUNTIME_ROLE}'.")

            # f-string is safe here: db_name/RUNTIME_ROLE come from Django
            # settings and a hardcoded constant, never request input.
            cursor.execute(f'GRANT CONNECT ON DATABASE "{db_name}" TO {RUNTIME_ROLE}')
            cursor.execute(f"GRANT USAGE ON SCHEMA public TO {RUNTIME_ROLE}")
            cursor.execute(f"GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO {RUNTIME_ROLE}")
            cursor.execute(
                f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {RUNTIME_ROLE}"
            )
            # So tables/sequences added by future migrations are covered
            # without needing this command re-run in lockstep — though
            # re-running it (e.g. after every `migrate`) is still the
            # recommended, simpler mental model.
            cursor.execute(
                f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO {RUNTIME_ROLE}"
            )
            cursor.execute(
                "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES "
                f"TO {RUNTIME_ROLE}"
            )

        self.stdout.write(self.style.SUCCESS(f"'{RUNTIME_ROLE}' is ready for RLS-enforced serving."))
