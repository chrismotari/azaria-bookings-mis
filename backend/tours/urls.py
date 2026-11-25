from django.urls import path

from core.modules import module_urls

from . import views

urlpatterns = module_urls(
    "tours",
    [
        path("tours", views.TourListView.as_view()),
        path("tours/<uuid:pk>", views.TourDetailView.as_view()),
        path("tour-bookings", views.TourBookingListCreateView.as_view()),
        path("tour-bookings/<uuid:pk>", views.TourBookingDetailView.as_view()),
        path("tour-bookings/<uuid:pk>/cancel", views.TourBookingCancelView.as_view()),
        path("tour-bookings/<uuid:pk>/travellers", views.TravellersView.as_view()),
        path("tour-bookings/<uuid:pk>/travellers/<uuid:traveller_id>", views.TravellerDetailView.as_view()),
        path("admin/tours", views.AdminTourListView.as_view()),
        path("admin/tours/<uuid:pk>", views.AdminTourDetailView.as_view()),
        path("admin/tours/<uuid:pk>/cancel", views.AdminTourCancelView.as_view()),
        path("admin/tours/<uuid:pk>/notices", views.AdminTourNoticesView.as_view()),
        path("admin/tours/<uuid:pk>/photos", views.AdminTourPhotosView.as_view()),
        path("admin/tours/<uuid:pk>/photos/<uuid:photo_id>", views.AdminTourPhotoDetailView.as_view()),
        path("admin/tours/<uuid:pk>/bookings", views.AdminTourBookingsView.as_view()),
        path("admin/tour-bookings", views.AdminTourBookingListView.as_view()),
        path("admin/tour-bookings/<uuid:pk>", views.AdminTourBookingDetailView.as_view()),
        path("admin/tour-bookings/<uuid:pk>/cancel", views.AdminTourBookingCancelView.as_view()),
        path("admin/tour-bookings/<uuid:pk>/travellers", views.TravellersView.as_view(admin=True)),
        path(
            "admin/tour-bookings/<uuid:pk>/travellers/<uuid:traveller_id>",
            views.TravellerDetailView.as_view(admin=True),
        ),
    ],
)
