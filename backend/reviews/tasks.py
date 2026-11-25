import functools
import logging

from celery import shared_task

from core.emails import EMAIL_TASK_OPTIONS, format_date, send_email
from core.models import AppSettings
from core.tenancy import for_each_tenant, tenant_task

from .models import Review
from .services import KINDS, Kind, module_on, request_for, reviewable

logger = logging.getLogger(__name__)


def route_line(offer, trip_type):
    arrow = "⇄" if trip_type == "return" else "→"
    return f"{offer.origin.city} ({offer.origin.code}) {arrow} {offer.destination.city} ({offer.destination.code})"


def describe(kind, booking):
    """The trip as the review emails name it, and the path of the customer's booking in the app."""
    if kind == Kind.FLIGHT:
        return {
            "title": route_line(booking.offer, booking.trip_type),
            "dates": format_date(
                min((s.departure_date for s in booking.segments.all()), default=booking.offer.departure_date)
            ),
            "path": f"/bookings/{booking.pk}",
        }
    if kind == Kind.TOUR:
        tour = booking.tour
        return {
            "title": tour.title,
            "dates": f"{format_date(tour.start_date)} – {format_date(tour.end_date)}",
            "path": f"/bookings?tour={booking.pk}",
        }
    return {
        "title": booking.hotel.name,
        "dates": f"{format_date(booking.check_in)} – {format_date(booking.check_out)}",
        "path": f"/bookings?hotel={booking.pk}",
    }


RELATED = {
    Kind.FLIGHT: ["user", "offer__origin", "offer__destination"],
    Kind.TOUR: ["user", "tour"],
    Kind.HOTEL: ["user", "hotel"],
}


@tenant_task(**EMAIL_TASK_OPTIONS)
def notify_customer_review_request(kind, booking_id):
    kind = Kind(kind)
    if not module_on(kind):
        return
    booking = reviewable(kind).select_related(*RELATED[kind]).filter(pk=booking_id).first()
    if booking is None:
        return
    send_email(
        "review_request",
        "How was your trip?",
        booking.user.email,
        {"booking": booking, "kind": kind.value, **describe(kind, booking)},
    )


@tenant_task(**EMAIL_TASK_OPTIONS)
def notify_admin_new_review(review_id):
    review = (
        Review.objects.select_related(
            "user",
            "booking__offer__origin",
            "booking__offer__destination",
            "tour_booking__tour",
            "hotel_booking__hotel",
        )
        .filter(pk=review_id)
        .first()
    )
    if review is None or not module_on(review.kind):
        return
    details = describe(review.kind, getattr(review, KINDS[review.kind][0]))
    send_email(
        "new_review",
        f"New {review.rating}★ review: {details['title']}",
        AppSettings.get().admin_notification_email,
        {
            "review": review,
            "kind": review.kind,
            "stars": f"{'★' * review.rating}{'☆' * (5 - review.rating)} ({review.rating}/5)",
            **details,
        },
    )


def _request_reviews(kind):
    sent = request_for(kind)
    logger.info("Queued %d %s review request(s).", sent, kind.value)
    return sent


@shared_task
def request_reviews():
    """ "How was your trip?" for bookings that have become reviewable, per module, in every active tenant."""
    return sum(
        for_each_tenant(functools.partial(_request_reviews, kind), "request_reviews", KINDS[kind][2]) for kind in KINDS
    )
