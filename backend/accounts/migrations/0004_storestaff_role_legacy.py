from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0003_add_role_model"),
    ]

    operations = [
        migrations.RenameField(
            model_name="storestaff",
            old_name="role",
            new_name="role_legacy",
        ),
    ]
