"""The root host (TENANT_BASE_DOMAIN): the platform's Django admin and the platform API; no agency API."""

from django.conf import settings
from django.conf.urls.static import static
from django.urls import include, path, re_path

from config.admin_site import platform_site
from tenants.views import apple_app_site_association, assetlinks, no_tenant

urlpatterns = [
    path("django-admin/", platform_site.urls),
    path(".well-known/apple-app-site-association", apple_app_site_association),
    path(".well-known/assetlinks.json", assetlinks),
    path("api/platform/", include("tenants.urls_platform")),
    re_path(r"^api/", no_tenant),
] + static(settings.MEDIA_URL, document_root=settings.PUBLIC_MEDIA_ROOT)
