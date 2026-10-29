from django.urls import path

from . import views

urlpatterns = [
    path("airports", views.AirportSearchView.as_view()),
]
