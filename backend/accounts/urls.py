from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from . import views
from .tokens import TenantTokenRefreshSerializer

urlpatterns = [
    path("register", views.RegisterView.as_view()),
    path("login", views.LoginView.as_view()),
    path("refresh", TokenRefreshView.as_view(serializer_class=TenantTokenRefreshSerializer)),
    path("me", views.MeView.as_view()),
    path("password-reset", views.PasswordResetRequestView.as_view()),
    path("password-reset-confirm", views.PasswordResetConfirmView.as_view()),
]
