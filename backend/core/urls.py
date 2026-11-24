from django.urls import path

from . import views

urlpatterns = [
    path("admin/settings", views.AdminSettingsView.as_view()),
    path("admin/themes", views.AdminThemeListView.as_view()),
]
