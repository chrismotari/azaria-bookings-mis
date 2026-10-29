from django.urls import path

from . import views

urlpatterns = [
    path("queries", views.QueryListCreateView.as_view()),
    path("queries/<int:pk>", views.QueryDetailView.as_view()),
    path("queries/<int:pk>/close", views.QueryCloseView.as_view()),
    path("admin/queries", views.AdminQueryListView.as_view()),
    path("admin/queries/<int:pk>", views.AdminQueryDetailView.as_view()),
    path("admin/queries/<int:pk>/respond", views.AdminQueryRespondView.as_view()),
]
