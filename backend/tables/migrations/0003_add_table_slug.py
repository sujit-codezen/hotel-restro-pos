# Split from the auto-generated migration: adding the slug field and its
# unique_together constraint in one step would fail immediately against
# existing rows (every Table already has slug="", which collides with
# itself under a per-store unique constraint) — see 0004 for the backfill
# this depends on before 0005 can add that constraint.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("organizations", "0001_initial"),
        ("tables", "0002_alter_table_options"),
    ]

    operations = [
        migrations.AddField(
            model_name="table",
            name="slug",
            field=models.SlugField(blank=True, max_length=60),
        ),
    ]
