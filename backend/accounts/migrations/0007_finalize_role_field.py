import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0006_migrate_role_data"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="storestaff",
            name="role_legacy",
        ),
        migrations.AlterField(
            model_name="storestaff",
            name="role",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="staff_assignments",
                to="accounts.role",
            ),
        ),
    ]
