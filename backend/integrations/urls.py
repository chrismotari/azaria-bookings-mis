from django.urls import path

from . import views

urlpatterns = [
    path("admin/integrations", views.IntegrationListView.as_view()),
    path("admin/integrations/<uuid:pk>", views.IntegrationDetailView.as_view()),
    path("admin/integrations/<uuid:pk>/test", views.IntegrationTestView.as_view()),
    path("admin/routes", views.RouteListView.as_view()),
    path("admin/routes/<uuid:pk>", views.RouteDetailView.as_view()),
    path("admin/routes/<uuid:pk>/search", views.RouteSearchView.as_view()),
    path("admin/routes/<uuid:pk>/runs", views.RouteRunListView.as_view()),
    path("admin/search-usage", views.SearchUsageView.as_view()),
    path("admin/fares", views.FareListView.as_view()),
    path("admin/fares/history", views.FareHistoryView.as_view()),
    path("admin/fares/<uuid:pk>/publish", views.FarePublishView.as_view()),
    path("admin/fares/<uuid:pk>/dismiss", views.FareDismissView.as_view()),
]
