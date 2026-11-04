from django.conf import settings
from django.db import migrations


def create_public_tenant(apps, schema_editor):
    """The platform itself (app_admin): the public schema, reached at TENANT_BASE_DOMAIN."""
    Tenant = apps.get_model("tenants", "Tenant")
    Domain = apps.get_model("tenants", "Domain")
    tenant, _ = Tenant.objects.get_or_create(schema_name="public", defaults={"name": "app_admin"})
    Domain.objects.get_or_create(domain=settings.TENANT_BASE_DOMAIN, defaults={"tenant": tenant, "is_primary": True})


class Migration(migrations.Migration):
    dependencies = [("tenants", "0001_initial")]

    operations = [migrations.RunPython(create_public_tenant, migrations.RunPython.noop)]
