import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0004_storestaff_role_legacy"),
    ]

    operations = [
        migrations.AddField(
            model_name="storestaff",
            name="role",
            field=models.ForeignKey(
                null=True,
                blank=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="staff_assignments",
                to="accounts.role",
            ),
        ),
    ]
