from django.urls import path

from . import views

urlpatterns = [
    path("explore", views.ExploreView.as_view()),
    path("admin/settings", views.AdminSettingsView.as_view()),
    path("admin/themes", views.AdminThemeListView.as_view()),
]
