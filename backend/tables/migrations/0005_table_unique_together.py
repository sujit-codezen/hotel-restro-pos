from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("tables", "0004_backfill_table_slugs"),
    ]

    operations = [
        migrations.AlterUniqueTogether(
            name="table",
            unique_together={("store", "name"), ("store", "slug")},
        ),
    ]
