from django.urls import path

from core.modules import module_urls

from . import views

urlpatterns = module_urls(
    "flights",
    [
        path("queries", views.QueryListCreateView.as_view()),
        path("queries/<uuid:pk>", views.QueryDetailView.as_view()),
        path("queries/<uuid:pk>/close", views.QueryCloseView.as_view()),
        path("admin/queries", views.AdminQueryListView.as_view()),
        path("admin/queries/<uuid:pk>", views.AdminQueryDetailView.as_view()),
        path("admin/queries/<uuid:pk>/respond", views.AdminQueryRespondView.as_view()),
    ],
)
