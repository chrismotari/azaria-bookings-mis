from django.urls import path

from . import views

urlpatterns = [
    path("explore", views.ExploreView.as_view()),
    path("admin/settings", views.AdminSettingsView.as_view()),
    path("admin/mail-server", views.AdminMailServerView.as_view()),
    path("admin/mail-server/test", views.AdminMailServerTestView.as_view()),
    path("admin/themes", views.AdminThemeListView.as_view()),
]
