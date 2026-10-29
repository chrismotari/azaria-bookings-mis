from django.urls import path

from . import views

urlpatterns = [
    path("airports", views.AirportSearchView.as_view()),
    path("offerings", views.OfferingListView.as_view()),
    path("offerings/<int:pk>", views.OfferingDetailView.as_view()),
    path("admin/offerings", views.AdminOfferingListView.as_view()),
    path("admin/offerings/<int:pk>", views.AdminOfferingDetailView.as_view()),
]
