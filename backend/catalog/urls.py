from django.urls import path

from . import views

urlpatterns = [
    path("airports", views.AirportSearchView.as_view()),
    path("offers", views.OfferListView.as_view()),
    path("offers/<int:pk>", views.OfferDetailView.as_view()),
    path("admin/offers", views.AdminOfferListView.as_view()),
    path("admin/offers/<int:pk>", views.AdminOfferDetailView.as_view()),
]
