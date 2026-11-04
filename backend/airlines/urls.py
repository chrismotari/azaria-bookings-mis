from django.urls import path

from . import views

urlpatterns = [
    path("airlines", views.AirlineSearchView.as_view()),
]
