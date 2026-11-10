from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from accounts.tokens import TenantTokenRefreshSerializer

from . import platform_views as views

urlpatterns = [
    path("login", views.PlatformLoginView.as_view()),
    path("refresh", TokenRefreshView.as_view(serializer_class=TenantTokenRefreshSerializer)),
    path("me", views.PlatformMeView.as_view()),
    path("tenants", views.PlatformTenantListView.as_view()),
    path("tenants/<int:pk>", views.PlatformTenantDetailView.as_view()),
    path("tenants/<int:pk>/domains", views.PlatformDomainListView.as_view()),
    path("tenants/<int:pk>/domains/<int:domain_id>", views.PlatformDomainDetailView.as_view()),
    path("tenants/<int:pk>/domains/<int:domain_id>/make-primary", views.PlatformDomainMakePrimaryView.as_view()),
]
