from django.urls import path

from . import views
from .models import Booking

Status = Booking.Status

urlpatterns = [
    path("bookings", views.BookingListCreateView.as_view()),
    path("bookings/<int:pk>", views.BookingDetailView.as_view()),
    path("bookings/<int:pk>/cancel", views.BookingCancelView.as_view()),
    path("admin/dashboard", views.AdminDashboardView.as_view()),
    path("admin/bookings", views.AdminBookingListView.as_view()),
    path("admin/bookings/<int:pk>", views.AdminBookingDetailView.as_view()),
    path(
        "admin/bookings/<int:pk>/confirm-availability",
        views.AdminBookingTransitionView.as_view(to_status=Status.AVAILABILITY_CONFIRMED),
    ),
    path(
        "admin/bookings/<int:pk>/mark-unavailable",
        views.AdminBookingTransitionView.as_view(to_status=Status.UNAVAILABLE),
    ),
    path("admin/bookings/<int:pk>/mark-paid", views.AdminBookingTransitionView.as_view(to_status=Status.PAID)),
]
