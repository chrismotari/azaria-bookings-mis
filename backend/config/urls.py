from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.urls import include, path

urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/", include("accounts.urls_admin")),
    path("api/", include("catalog.urls")),
    path("api/", include("airlines.urls")),
    path("api/", include("customer_requests.urls")),
    path("api/", include("bookings.urls")),
    path("api/", include("core.urls")),
    path("api/", include("tenants.urls_billing")),
] + static(settings.MEDIA_URL, document_root=settings.PUBLIC_MEDIA_ROOT)
