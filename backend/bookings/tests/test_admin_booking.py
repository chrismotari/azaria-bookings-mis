"""The admin books for a customer."""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.core import mail
from django.utils import timezone

from accounts.models import User
from bookings.models import Booking, BookingEvent
from core.models import AppSettings

pytestmark = pytest.mark.django_db

Status = Booking.Status


def book(admin_api, customer, offer, capture=None, **overrides):
    body = {"user": str(customer.id), "offer": str(offer.id), "passenger_count": 3, "notes": "By phone", **overrides}
    if capture is None:
        return admin_api.post("/api/admin/bookings", body, format="json")
    with capture(execute=True) as callbacks:
        response = admin_api.post("/api/admin/bookings", body, format="json")
    return response, callbacks


def test_admin_books_for_a_customer(
    admin_api, admin_user, customer, make_offer, airports, django_capture_on_commit_callbacks
):
    offer = make_offer(price=Decimal("400.00"))
    response, callbacks = book(admin_api, customer, offer, django_capture_on_commit_callbacks)
    assert response.status_code == 201, response.data
    assert response.data["status"] == "requested"
    assert response.data["user"]["email"] == customer.email
    assert response.data["total_price"] == "1200.00"
    assert response.data["notes"] == "By phone"
    assert response.data["itinerary"]["outbound"]["segments"][0]["flight_number"] == "100"

    booking = Booking.objects.get(pk=response.data["id"])
    assert (booking.user, booking.offer, booking.passenger_count, booking.unit_price) == (
        customer,
        offer,
        3,
        Decimal("400.00"),
    )
    [event] = BookingEvent.objects.filter(booking=booking)
    assert (event.from_status, event.to_status, event.actor) == ("", Status.REQUESTED, admin_user)
    # No emails: the admin made the booking.
    assert callbacks == []
    assert mail.outbox == []
    # The customer sees it as their own.
    assert booking in Booking.objects.filter(user=customer)


def test_the_booking_then_follows_the_normal_flow(admin_api, customer_api, customer, make_offer):
    AppSettings.objects.update(payment_instructions="M-Pesa paybill 123456.")
    booking_id = book(admin_api, customer, make_offer()).data["id"]
    assert customer_api.get(f"/api/bookings/{booking_id}").status_code == 200
    assert admin_api.post(f"/api/admin/bookings/{booking_id}/confirm-availability").status_code == 200
    assert customer_api.post(f"/api/bookings/{booking_id}/cancel").data["status"] == "cancelled"


def test_admin_can_book_a_private_offer_which_the_customer_can_then_open(admin_api, customer_api, customer, make_offer):
    private = make_offer(is_public=False)
    assert customer_api.get(f"/api/offers/{private.id}").status_code == 404
    assert book(admin_api, customer, private).status_code == 201
    assert customer_api.get(f"/api/offers/{private.id}").status_code == 200


@pytest.mark.parametrize(
    "unbookable",
    [
        {"is_active": False},
        {"valid_until": timezone.localdate() - timedelta(days=1)},
        {
            "departure_date": timezone.localdate() - timedelta(days=1),
            "valid_until": timezone.localdate() - timedelta(days=2),
        },
    ],
)
def test_the_offer_must_be_bookable(admin_api, customer, make_offer, unbookable):
    response = book(admin_api, customer, make_offer(**unbookable))
    assert response.status_code == 400
    assert "offer" in response.data
    assert not Booking.objects.exists()


def test_the_user_must_be_an_active_customer(admin_api, admin_user, customer, make_offer):
    offer = make_offer()
    User.objects.filter(pk=customer.pk).update(is_active=False)
    for user in (customer, admin_user):
        response = book(admin_api, user, offer)
        assert response.status_code == 400
        assert response.data["user"] == ["Choose an active customer."]
    assert book(admin_api, customer, offer, user="00000000-0000-4000-8000-000000000000").status_code == 400
    assert not Booking.objects.exists()


def test_the_duplicate_booking_rule_applies(admin_api, customer, other_customer, make_offer):
    offer = make_offer()
    assert book(admin_api, customer, offer).status_code == 201
    second = book(admin_api, customer, offer)
    assert second.status_code == 409
    assert "already has an active booking" in second.data["detail"]
    # Another customer can book the same offer.
    assert book(admin_api, other_customer, offer).status_code == 201


@pytest.mark.parametrize(("count", "ok"), [(0, False), (1, True), (9, True), (10, False)])
def test_passenger_count_limits(admin_api, customer, make_offer, count, ok):
    response = book(admin_api, customer, make_offer(), passenger_count=count)
    assert (response.status_code == 201) is ok
    if not ok:
        assert "passenger_count" in response.data


def test_only_admins_can_book_for_customers(api, customer_api, customer, make_offer):
    offer = make_offer()
    body = {"user": str(customer.id), "offer": str(offer.id), "passenger_count": 1}
    assert api.post("/api/admin/bookings", body, format="json").status_code == 401
    assert customer_api.post("/api/admin/bookings", body, format="json").status_code == 403
