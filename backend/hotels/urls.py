from django.urls import path

from core.modules import module_urls

from . import views

urlpatterns = module_urls(
    "hotels",
    [
        path("hotels", views.HotelListView.as_view()),
        path("hotels/<uuid:pk>", views.HotelDetailView.as_view()),
        path("hotel-bookings", views.HotelBookingListCreateView.as_view()),
        path("hotel-bookings/<uuid:pk>", views.HotelBookingDetailView.as_view()),
        *(
            path(f"hotel-bookings/<uuid:pk>/{action}", views.HotelBookingActionView.as_view(action=action))
            for action in ("cancel", "accept-changes", "decline-changes")
        ),
        path("hotel-bookings/<uuid:pk>/rooms/<uuid:room_id>/guests", views.GuestsView.as_view()),
        path("hotel-bookings/<uuid:pk>/guests/<uuid:traveller_id>", views.GuestDetailView.as_view()),
        path("hotel-vouchers/<uuid:pk>/download", views.VoucherDownloadView.as_view()),
        path("admin/hotels", views.AdminHotelListView.as_view()),
        path("admin/hotels/<uuid:pk>", views.AdminHotelDetailView.as_view()),
        path("admin/hotels/<uuid:pk>/photos", views.AdminHotelPhotosView.as_view()),
        path("admin/hotels/<uuid:pk>/photos/<uuid:photo_id>", views.AdminHotelPhotoDetailView.as_view()),
        path("admin/hotel-bookings", views.AdminHotelBookingListView.as_view()),
        path("admin/hotel-bookings/<uuid:pk>", views.AdminHotelBookingDetailView.as_view()),
        *(
            path(f"admin/hotel-bookings/<uuid:pk>/{action}", views.AdminHotelBookingActionView.as_view(action=action))
            for action in ("confirm-availability", "mark-unavailable", "mark-paid", "complete")
        ),
        path("admin/hotel-bookings/<uuid:pk>/vouchers", views.AdminVoucherUploadView.as_view()),
        path("admin/hotel-bookings/<uuid:pk>/rooms/<uuid:room_id>/guests", views.GuestsView.as_view(admin=True)),
        path("admin/hotel-bookings/<uuid:pk>/guests/<uuid:traveller_id>", views.GuestDetailView.as_view(admin=True)),
        path("admin/hotel-vouchers/<uuid:pk>", views.AdminVoucherDeleteView.as_view()),
    ],
)
