"""Who can review what and when, and every change to a review."""

from django.db import transaction
from django.db.models import Max
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework.exceptions import NotFound

from bookings.models import Booking
from core.exceptions import Conflict
from core.modules import MODULE_OFF
from core.tenancy import current_tenant, queue
from hotels.models import HotelBooking
from tours.models import TourBooking

from .models import Review

Kind = Review.Kind

# kind: (the review's booking field, the booking model, the module)
KINDS = {
    Kind.FLIGHT: ("booking", Booking, "flights"),
    Kind.TOUR: ("tour_booking", TourBooking, "tours"),
    Kind.HOTEL: ("hotel_booking", HotelBooking, "hotels"),
}
NEVER_REVIEWED = {"cancelled", "unavailable", "expired", "declined"}


class ModuleOff(NotFound):
    default_detail = MODULE_OFF


def module_on(kind):
    return current_tenant().has_module(KINDS[kind][2])


def require_module(kind):
    if not module_on(kind):
        raise ModuleOff()


def kinds_on():
    tenant = current_tenant()
    return [kind for kind, (_, _, module) in KINDS.items() if tenant.has_module(module)]


def last_flight_date(booking):
    dates = [segment.departure_date for segment in booking.segments.all()]
    return max(dates, default=booking.offer.departure_date)


def finished(kind, booking):
    """The trip has ended: a completed booking, after its last flight's date or on or after check-out."""
    if booking.status != "completed":
        return False
    today = timezone.localdate()
    if kind == Kind.FLIGHT:
        return last_flight_date(booking) < today
    if kind == Kind.HOTEL:
        return booking.check_out <= today
    return True


def has_review(booking):
    return hasattr(booking, "review")


def can_review(kind, booking):
    """For the booking's own customer: once per booking, after the trip has ended."""
    return not has_review(booking) and finished(kind, booking)


def reviewable(kind):
    """Bookings whose trip has ended, without a review."""
    today = timezone.localdate()
    model = KINDS[kind][1]
    bookings = model.objects.filter(status="completed", review__isnull=True)
    if kind == Kind.FLIGHT:
        last_flight = Coalesce(Max("segments__departure_date"), "offer__departure_date")
        return bookings.annotate(last_flight=last_flight).filter(last_flight__lt=today)
    if kind == Kind.HOTEL:
        return bookings.filter(check_out__lte=today)
    return bookings


def create_review(user, kind, booking_id, rating, comment):
    from . import tasks

    require_module(kind)
    field, model, _ = KINDS[kind]
    with transaction.atomic():
        booking = model.objects.select_for_update().filter(pk=booking_id, user=user).first()
        if booking is None:
            raise NotFound("Booking not found.")
        if Review.objects.filter(**{field: booking}).exists():
            raise Conflict("You have already reviewed this booking.")
        if booking.status in NEVER_REVIEWED:
            raise Conflict("This booking can't be reviewed.")
        if not finished(kind, booking):
            raise Conflict("You can review this booking once your trip has ended.")
        review = Review.objects.create(
            **{field: booking},
            kind=kind,
            tour_id=getattr(booking, "tour_id", None),
            hotel_id=getattr(booking, "hotel_id", None),
            user=user,
            rating=rating,
            comment=comment,
        )
        queue(tasks.notify_admin_new_review, str(review.pk))
    return review


def change_review(review, fields):
    """The author's edit of rating and comment; the reply is kept. No email."""
    require_module(review.kind)
    for name, value in fields.items():
        setattr(review, name, value)
    review.save()
    return review


def delete_review(review):
    """The author's delete; the reply goes with it."""
    require_module(review.kind)
    review.delete()


def set_hidden(review, admin, hidden):
    require_module(review.kind)
    review.is_hidden = hidden
    review.hidden_by = admin if hidden else None
    review.hidden_at = timezone.now() if hidden else None
    review.save(update_fields=["is_hidden", "hidden_by", "hidden_at", "updated_at"])
    return review


def set_reply(review, admin, reply):
    """The agency's one public reply; blank removes it."""
    require_module(review.kind)
    reply = reply.strip()
    review.reply = reply
    review.replied_by = admin if reply else None
    review.replied_at = timezone.now() if reply else None
    review.save(update_fields=["reply", "replied_by", "replied_at", "updated_at"])
    return review


def request_for(kind):
    """Queues "How was your trip?" once for each booking that has become reviewable."""
    from . import tasks

    model = KINDS[kind][1]
    sent = 0
    for booking_id in list(reviewable(kind).filter(review_requested_at__isnull=True).values_list("pk", flat=True)):
        with transaction.atomic():
            if not model.objects.filter(pk=booking_id, review_requested_at__isnull=True).update(
                review_requested_at=timezone.now()
            ):
                continue
            queue(tasks.notify_customer_review_request, kind.value, str(booking_id))
        sent += 1
    return sent
