from django.urls import path

from core.modules import module_urls

from . import views

urlpatterns = [
    path("airports", views.AirportSearchView.as_view()),
] + module_urls(
    "flights",
    [
        path("offers", views.OfferListView.as_view()),
        path("offers/<uuid:pk>", views.OfferDetailView.as_view()),
        path("admin/offers", views.AdminOfferListView.as_view()),
        path("admin/offers/<uuid:pk>", views.AdminOfferDetailView.as_view()),
    ],
)
