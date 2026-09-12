from django.db import migrations
from django.utils.text import slugify


def backfill_slugs(apps, schema_editor):
    Table = apps.get_model("tables", "Table")
    for table in Table.objects.order_by("store_id", "created_at").all():
        base = slugify(table.name)[:50] or "table"
        slug = base
        suffix = 1
        while Table.objects.filter(store_id=table.store_id, slug=slug).exclude(pk=table.pk).exists():
            suffix += 1
            slug = f"{base}-{suffix}"
        table.slug = slug
        table.save(update_fields=["slug"])


class Migration(migrations.Migration):

    dependencies = [
        ("tables", "0003_add_table_slug"),
    ]

    operations = [
        migrations.RunPython(backfill_slugs, migrations.RunPython.noop),
    ]
