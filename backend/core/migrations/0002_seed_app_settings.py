from django.conf import settings
from django.db import migrations


def create_app_settings(apps, schema_editor):
    AppSettings = apps.get_model("core", "AppSettings")
    AppSettings.objects.get_or_create(pk=1, defaults={"admin_notification_email": settings.ADMIN_EMAIL})


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(create_app_settings, migrations.RunPython.noop),
    ]
