from django.db import migrations


def create_platform_settings(apps, schema_editor):
    """The single PlatformSettings row (pk=1)."""
    apps.get_model("tenants", "PlatformSettings").objects.get_or_create(pk=1)


class Migration(migrations.Migration):
    dependencies = [("tenants", "0003_billing")]

    operations = [migrations.RunPython(create_platform_settings, migrations.RunPython.noop)]
