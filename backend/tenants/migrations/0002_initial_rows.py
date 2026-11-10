from django.conf import settings
from django.db import migrations


def create_rows(apps, schema_editor):
    """The platform itself (app_admin): the public schema, reached at TENANT_BASE_DOMAIN; and its settings row."""
    Tenant = apps.get_model("tenants", "Tenant")
    Domain = apps.get_model("tenants", "Domain")
    PlatformSettings = apps.get_model("tenants", "PlatformSettings")
    tenant, _ = Tenant.objects.get_or_create(schema_name="public", defaults={"name": "app_admin"})
    Domain.objects.get_or_create(domain=settings.TENANT_BASE_DOMAIN, defaults={"tenant": tenant, "is_primary": True})
    if not PlatformSettings.objects.exists():
        PlatformSettings.objects.create()


class Migration(migrations.Migration):
    dependencies = [("tenants", "0001_initial")]

    operations = [migrations.RunPython(create_rows, migrations.RunPython.noop)]
