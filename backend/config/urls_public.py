"""The root host (TENANT_BASE_DOMAIN): the platform's Django admin only; there is no API here."""

from django.urls import path, re_path

from config.admin_site import platform_site
from tenants.views import no_tenant

urlpatterns = [
    path("django-admin/", platform_site.urls),
    re_path(r"^api/", no_tenant),
]
