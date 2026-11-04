from django.urls import path

from . import views
from .models import Booking

Status = Booking.Status

urlpatterns = [
    path("bookings", views.BookingListCreateView.as_view()),
    path("bookings/<uuid:pk>", views.BookingDetailView.as_view()),
    path("bookings/<uuid:pk>/cancel", views.BookingCancelView.as_view()),
    path("bookings/<uuid:pk>/accept-changes", views.BookingAcceptChangesView.as_view()),
    path("bookings/<uuid:pk>/decline-changes", views.BookingDeclineChangesView.as_view()),
    path("boarding-passes/<uuid:pk>/download", views.BoardingPassDownloadView.as_view()),
    path("admin/dashboard", views.AdminDashboardView.as_view()),
    path("admin/bookings", views.AdminBookingListView.as_view()),
    path("admin/bookings/<uuid:pk>", views.AdminBookingDetailView.as_view()),
    path("admin/bookings/<uuid:pk>/confirm-availability", views.AdminConfirmAvailabilityView.as_view()),
    path("admin/bookings/<uuid:pk>/mark-unavailable", views.AdminMarkUnavailableView.as_view()),
    path("admin/bookings/<uuid:pk>/mark-paid", views.AdminBookingTransitionView.as_view(to_status=Status.PAID)),
    # "Send boarding passes".
    path("admin/bookings/<uuid:pk>/complete", views.AdminBookingTransitionView.as_view(to_status=Status.COMPLETED)),
    path("admin/bookings/<uuid:pk>/boarding-passes", views.AdminBoardingPassUploadView.as_view()),
    path("admin/boarding-passes/<uuid:pk>", views.AdminBoardingPassDeleteView.as_view()),
]
