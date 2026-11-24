import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("tenants", "0004_starting_themes")]

    operations = [
        migrations.AlterField(
            model_name="tenant",
            name="theme",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="tenants", to="tenants.theme"
            ),
        ),
    ]
