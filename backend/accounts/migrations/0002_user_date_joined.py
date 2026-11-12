import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        # Existing users keep no date (unknown); only users created from now on get one.
        migrations.AddField(
            model_name="user",
            name="date_joined",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="user",
            name="date_joined",
            field=models.DateTimeField(blank=True, default=django.utils.timezone.now, null=True),
        ),
    ]
