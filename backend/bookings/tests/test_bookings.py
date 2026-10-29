from datetime import timedelta
from decimal import Decimal

import pytest
from django.core import mail
from django.core.files.base import ContentFile
from django.utils import timezone
from freezegun import freeze_time

from bookings import tasks
from bookings.models import BoardingPass, Booking, BookingEvent
from bookings.services import TRANSITIONS, InvalidTransition, create_booking, transition
from core.models import AppSettings
from customer_requests.models import Query, QueryResponse

pytestmark = pytest.mark.django_db

Status = Booking.Status

NOW = "2026-03-02 09:00:00+03:00"


@pytest.fixture
def payment_instructions(db):
    AppSettings.objects.filter(pk=1).update(payment_instructions="M-Pesa paybill 123456, account AZARIA.")


@pytest.fixture
def offering(make_offering):
    return make_offering(price=Decimal("650.00"))


@pytest.fixture
def make_booking(customer, offering):
    def make(status=Status.REQUESTED, user=None, **kwargs):
        fields = {"passenger_count": 2, "unit_price": offering.price, **kwargs}
        if status == Status.AVAILABILITY_CONFIRMED:
            fields.setdefault("payment_deadline", timezone.now() + timedelta(hours=24))
        booking = Booking.objects.create(user=user or customer, offering=offering, status=status, **fields)
        if status == Status.PAID:
            # Ready to complete.
            BoardingPass(booking=booking, original_name="pass.pdf").file.save("pass.pdf", ContentFile(b"%PDF-"))
        return booking

    return make


# Access


def test_guests_get_401_on_bookings(api, make_booking):
    booking = make_booking()
    assert api.get("/api/bookings").status_code == 401
    assert api.post("/api/bookings", {}, format="json").status_code == 401
    assert api.get(f"/api/bookings/{booking.id}").status_code == 401
    assert api.post(f"/api/bookings/{booking.id}/cancel").status_code == 401


def test_admin_booking_endpoints_reject_customers_and_guests(api, customer_api, make_booking):
    booking = make_booking()
    for client, code in [(api, 401), (customer_api, 403)]:
        assert client.get("/api/admin/dashboard").status_code == code
        assert client.get("/api/admin/bookings").status_code == code
        assert client.get(f"/api/admin/bookings/{booking.id}").status_code == code
        for action in ["confirm-availability", "mark-unavailable", "mark-paid"]:
            assert client.post(f"/api/admin/bookings/{booking.id}/{action}").status_code == code
    booking.refresh_from_db()
    assert booking.status == Status.REQUESTED


def test_customers_cannot_read_or_cancel_other_customers_bookings(other_customer_api, make_booking):
    booking = make_booking()
    assert other_customer_api.get("/api/bookings").data["results"] == []
    assert other_customer_api.get(f"/api/bookings/{booking.id}").status_code == 404
    assert other_customer_api.post(f"/api/bookings/{booking.id}/cancel").status_code == 404
    booking.refresh_from_db()
    assert booking.status == Status.REQUESTED


# Creation


def test_customer_books_and_admin_is_emailed(customer_api, customer, offering, django_capture_on_commit_callbacks):
    payload = {"offering": offering.id, "passenger_count": 3, "notes": "Window seats please."}
    with django_capture_on_commit_callbacks(execute=True):
        response = customer_api.post("/api/bookings", payload, format="json")
    assert response.status_code == 201, response.data
    assert response.data["status"] == "requested"
    assert response.data["unit_price"] == "650.00"
    assert response.data["total_price"] == "1950.00"
    assert response.data["offering"]["airline"] == "Kenya Airways"
    [event] = response.data["events"]
    assert event["from_status"] == ""
    assert event["to_status"] == "requested"

    booking = Booking.objects.get(pk=response.data["id"])
    assert booking.user == customer
    assert BookingEvent.objects.get(booking=booking).actor == customer

    assert len(mail.outbox) == 1
    email = mail.outbox[0]
    assert email.to == [AppSettings.get().admin_notification_email]
    for expected in [
        "Cara Customer",
        "customer@example.com",
        "Nairobi (NBO) → London (LHR)",
        "Class: Economy",
        "Airline: Kenya Airways",
        "Passengers: 3",
        "Total price: USD 1,950.00",
        "Window seats please.",
        f"/admin/bookings/{booking.id}",
    ]:
        assert expected in email.body


def test_unit_price_is_copied_at_creation(customer, offering):
    booking = create_booking(customer, {"offering": offering.id, "passenger_count": 1})
    offering.price = Decimal("999.00")
    offering.save()
    booking.refresh_from_db()
    assert booking.unit_price == Decimal("650.00")


@pytest.mark.parametrize("count", [0, 10])
def test_passenger_count_bounds(customer_api, offering, count):
    response = customer_api.post("/api/bookings", {"offering": offering.id, "passenger_count": count}, format="json")
    assert response.status_code == 400
    assert "passenger_count" in response.data


@pytest.mark.parametrize("count", [1, 9])
def test_passenger_count_limits_are_inclusive(customer_api, offering, count):
    response = customer_api.post("/api/bookings", {"offering": offering.id, "passenger_count": count}, format="json")
    assert response.status_code == 201


@pytest.mark.parametrize(
    "overrides",
    [
        {"is_active": False},
        {"is_public": False},
        {"departure_date": timezone.localdate() - timedelta(days=1), "valid_until": timezone.localdate() - timedelta(days=2)},
    ],
)
def test_cannot_book_unbookable_or_hidden_offering(customer_api, make_offering, overrides):
    offering = make_offering(**overrides)
    response = customer_api.post("/api/bookings", {"offering": offering.id, "passenger_count": 1}, format="json")
    assert response.status_code == 400
    assert "offering" in response.data
    assert Booking.objects.count() == 0


def test_cannot_book_once_valid_until_has_passed(customer_api, offering):
    with freeze_time(timezone.localdate() + timedelta(days=11)):
        response = customer_api.post("/api/bookings", {"offering": offering.id, "passenger_count": 1}, format="json")
    assert response.status_code == 400


def test_cannot_book_unknown_offering(customer_api):
    response = customer_api.post("/api/bookings", {"offering": 999999, "passenger_count": 1}, format="json")
    assert response.status_code == 400
    assert "offering" in response.data


def test_customer_can_book_private_offering_sent_to_them(customer_api, other_customer_api, customer, make_offering):
    private = make_offering(is_public=False)
    query = Query.objects.create(user=customer, destination=private.destination, date_from=timezone.localdate())
    QueryResponse.objects.create(query=query).offerings.set([private])

    payload = {"offering": private.id, "passenger_count": 1, "query": query.id}
    assert other_customer_api.post("/api/bookings", {**payload, "query": None}, format="json").status_code == 400
    response = customer_api.post("/api/bookings", payload, format="json")
    assert response.status_code == 201, response.data
    assert response.data["query"] == query.id


def test_cannot_link_another_customers_query(customer_api, other_customer, offering):
    query = Query.objects.create(user=other_customer, destination=offering.destination, date_from=timezone.localdate())
    response = customer_api.post(
        "/api/bookings", {"offering": offering.id, "passenger_count": 1, "query": query.id}, format="json"
    )
    assert response.status_code == 400
    assert "query" in response.data


@pytest.mark.parametrize("status", Booking.ACTIVE_STATUSES)
def test_duplicate_active_booking_is_refused(customer_api, offering, make_booking, status):
    make_booking(status=status)
    response = customer_api.post("/api/bookings", {"offering": offering.id, "passenger_count": 1}, format="json")
    assert response.status_code == 409
    assert Booking.objects.count() == 1


@pytest.mark.parametrize("status", [Status.COMPLETED, Status.UNAVAILABLE, Status.CANCELLED, Status.EXPIRED])
def test_can_book_again_after_a_finished_booking(customer_api, offering, make_booking, status):
    make_booking(status=status)
    response = customer_api.post("/api/bookings", {"offering": offering.id, "passenger_count": 1}, format="json")
    assert response.status_code == 201


def test_another_customer_may_book_the_same_offering(other_customer_api, offering, make_booking):
    make_booking()
    response = other_customer_api.post("/api/bookings", {"offering": offering.id, "passenger_count": 1}, format="json")
    assert response.status_code == 201


def test_customer_lists_only_own_bookings(customer_api, make_booking, other_customer):
    mine = make_booking()
    make_booking(user=other_customer)
    response = customer_api.get("/api/bookings")
    assert [b["id"] for b in response.data["results"]] == [mine.id]
    assert response.data["results"][0]["total_price"] == "1300.00"


# The state machine

ACTORS = ["admin", "customer", "other_customer", "system"]


@pytest.fixture
def actors(admin_user, customer, other_customer):
    return {"admin": admin_user, "customer": customer, "other_customer": other_customer, "system": None}


@pytest.mark.parametrize(("from_status", "to_status"), list(TRANSITIONS))
def test_every_allowed_transition_succeeds_for_its_actor(
    make_booking, actors, payment_instructions, from_status, to_status
):
    booking = make_booking(status=from_status)
    allowed = TRANSITIONS[(from_status, to_status)]
    result = transition(booking.id, to_status, actors[allowed])
    assert result.status == to_status
    event = BookingEvent.objects.get(booking=booking)
    assert (event.from_status, event.to_status, event.actor) == (from_status, to_status, actors[allowed])


REFUSED = [
    (from_status, to_status, actor)
    for from_status in Status.values
    for to_status in Status.values
    for actor in ACTORS
    if TRANSITIONS.get((from_status, to_status)) != actor
]


@pytest.mark.parametrize(("from_status", "to_status", "actor"), REFUSED)
def test_every_other_combination_is_refused(make_booking, actors, payment_instructions, from_status, to_status, actor):
    booking = make_booking(status=from_status)
    with pytest.raises(InvalidTransition):
        transition(booking.id, to_status, actors[actor])
    booking.refresh_from_db()
    assert booking.status == from_status
    assert not BookingEvent.objects.filter(booking=booking).exists()


EXPECTED_EMAILS = {
    Status.AVAILABILITY_CONFIRMED: "Seats confirmed",
    Status.UNAVAILABLE: "could not be confirmed",
    Status.PAID: "Payment received",
    Status.EXPIRED: "has expired",
    Status.COMPLETED: "boarding pass",
}


@pytest.mark.parametrize(("from_status", "to_status"), list(TRANSITIONS))
def test_each_transition_queues_exactly_its_email(
    make_booking, actors, payment_instructions, django_capture_on_commit_callbacks, from_status, to_status
):
    booking = make_booking(status=from_status)
    with django_capture_on_commit_callbacks(execute=True) as callbacks:
        transition(booking.id, to_status, actors[TRANSITIONS[(from_status, to_status)]])
    if to_status == Status.CANCELLED:
        assert callbacks == []
        assert mail.outbox == []
    else:
        assert len(callbacks) == 1
        [email] = mail.outbox
        assert email.to == ["customer@example.com"]
        assert EXPECTED_EMAILS[to_status] in email.subject


def test_booking_creation_queues_exactly_the_admin_email(customer, offering, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True) as callbacks:
        create_booking(customer, {"offering": offering.id, "passenger_count": 1})
    assert len(callbacks) == 1
    assert [email.subject.startswith("New booking") for email in mail.outbox] == [True]


@freeze_time(NOW)
def test_confirm_availability_sets_deadline_and_clears_reminder(admin_api, make_booking, payment_instructions):
    AppSettings.objects.filter(pk=1).update(payment_hold_hours=6)
    booking = make_booking(reminder_sent_at=timezone.now())
    response = admin_api.post(f"/api/admin/bookings/{booking.id}/confirm-availability")
    assert response.status_code == 200, response.data
    assert response.data["status"] == "availability_confirmed"
    assert response.data["user"]["email"] == "customer@example.com"
    booking.refresh_from_db()
    assert booking.payment_deadline == timezone.now() + timedelta(hours=6)
    assert booking.reminder_sent_at is None


def test_confirm_availability_fails_without_payment_instructions(admin_api, make_booking):
    AppSettings.objects.filter(pk=1).update(payment_instructions="  ")
    booking = make_booking()
    response = admin_api.post(f"/api/admin/bookings/{booking.id}/confirm-availability")
    assert response.status_code == 409
    assert "payment instructions" in response.data["detail"]
    booking.refresh_from_db()
    assert booking.status == Status.REQUESTED


def test_mark_paid_refused_after_the_deadline(admin_api, make_booking):
    booking = make_booking(status=Status.AVAILABILITY_CONFIRMED)
    with freeze_time(booking.payment_deadline + timedelta(seconds=1)):
        response = admin_api.post(f"/api/admin/bookings/{booking.id}/mark-paid")
    assert response.status_code == 409
    booking.refresh_from_db()
    assert booking.status == Status.AVAILABILITY_CONFIRMED


def test_mark_paid_and_mark_unavailable_through_the_api(admin_api, make_booking):
    paid = make_booking(status=Status.AVAILABILITY_CONFIRMED)
    assert admin_api.post(f"/api/admin/bookings/{paid.id}/mark-paid").data["status"] == "paid"
    unavailable = make_booking(status=Status.REQUESTED)
    response = admin_api.post(f"/api/admin/bookings/{unavailable.id}/mark-unavailable")
    assert response.data["status"] == "unavailable"


def test_invalid_admin_action_returns_409(admin_api, make_booking):
    booking = make_booking(status=Status.REQUESTED)
    response = admin_api.post(f"/api/admin/bookings/{booking.id}/mark-paid")
    assert response.status_code == 409
    assert response.data["detail"] == "A booking that is requested cannot be changed to paid."


def test_customer_cancels_own_booking(customer_api, make_booking):
    booking = make_booking(status=Status.AVAILABILITY_CONFIRMED)
    response = customer_api.post(f"/api/bookings/{booking.id}/cancel")
    assert response.status_code == 200
    assert response.data["status"] == "cancelled"
    assert [e["to_status"] for e in response.data["events"]] == ["cancelled"]
    assert customer_api.post(f"/api/bookings/{booking.id}/cancel").status_code == 409


def test_unknown_booking_returns_404(admin_api, customer_api):
    assert admin_api.post("/api/admin/bookings/999999/mark-paid").status_code == 404
    assert customer_api.post("/api/bookings/999999/cancel").status_code == 404


# Reading


def test_payment_instructions_shown_to_customer_only_while_payment_is_due(
    customer_api, make_booking, payment_instructions
):
    due = make_booking(status=Status.AVAILABILITY_CONFIRMED)
    response = customer_api.get(f"/api/bookings/{due.id}")
    assert response.data["payment_instructions"] == "M-Pesa paybill 123456, account AZARIA."
    assert response.data["payment_deadline"] is not None

    paid = make_booking(status=Status.PAID)
    assert customer_api.get(f"/api/bookings/{paid.id}").data["payment_instructions"] is None


def test_admin_lists_bookings_with_status_filter(admin_api, make_booking, other_customer):
    requested = make_booking()
    paid = make_booking(status=Status.PAID, user=other_customer)
    response = admin_api.get("/api/admin/bookings")
    assert {b["id"] for b in response.data["results"]} == {requested.id, paid.id}
    response = admin_api.get("/api/admin/bookings", {"status": "paid"})
    assert [b["id"] for b in response.data["results"]] == [paid.id]
    assert response.data["results"][0]["user"]["full_name"] == "Otto Other"


def test_admin_detail_includes_customer_and_timeline(admin_api, admin_user, customer, offering, payment_instructions):
    booking = create_booking(customer, {"offering": offering.id, "passenger_count": 2, "notes": "Vegetarian"})
    transition(booking.id, Status.AVAILABILITY_CONFIRMED, admin_user)
    response = admin_api.get(f"/api/admin/bookings/{booking.id}")
    assert response.status_code == 200
    assert response.data["user"]["phone"] == "+254700000001"
    assert response.data["notes"] == "Vegetarian"
    assert [(e["from_status"], e["to_status"]) for e in response.data["events"]] == [
        ("", "requested"),
        ("requested", "availability_confirmed"),
    ]


def test_dashboard_counts(admin_api, make_booking, other_customer, airports):
    Query.objects.create(user=other_customer, destination=airports["LHR"], date_from=timezone.localdate())
    Query.objects.create(user=other_customer, destination=airports["DXB"], date_from=timezone.localdate(), status="closed")
    make_booking(status=Status.REQUESTED)
    make_booking(status=Status.REQUESTED, user=other_customer)
    make_booking(status=Status.AVAILABILITY_CONFIRMED, user=other_customer)
    make_booking(status=Status.CANCELLED)
    response = admin_api.get("/api/admin/dashboard")
    assert response.data == {
        "open_queries": 1,
        "bookings_requested": 2,
        "bookings_awaiting_payment": 1,
        "bookings_paid_awaiting_boarding_pass": 0,
    }


# Email tasks


@freeze_time(NOW)
def test_availability_email_has_instructions_and_deadline_in_nairobi_time(make_booking, payment_instructions):
    booking = make_booking(status=Status.AVAILABILITY_CONFIRMED, payment_deadline=timezone.now() + timedelta(hours=24))
    tasks.notify_customer_availability_confirmed(booking.id)
    [email] = mail.outbox
    assert email.to == ["customer@example.com"]
    for expected in [
        "Nairobi (NBO) → London (LHR)",
        "Total price: USD 1,300.00",
        "M-Pesa paybill 123456, account AZARIA.",
        "Tue, 3 Mar 2026 at 09:00 (Nairobi time)",
        f"/bookings/{booking.id}",
    ]:
        assert expected in email.body


@pytest.mark.parametrize(
    ("task", "status", "expected"),
    [
        (tasks.notify_customer_unavailable, Status.UNAVAILABLE, "/requests/new"),
        (tasks.notify_customer_payment_received, Status.PAID, "boarding pass"),
        (tasks.notify_customer_booking_expired, Status.EXPIRED, "did not receive your payment in time"),
    ],
)
def test_customer_email_content(make_booking, task, status, expected):
    booking = make_booking(status=status)
    task(booking.id)
    [email] = mail.outbox
    assert email.to == ["customer@example.com"]
    assert "Hello Cara Customer" in email.body
    assert "Nairobi (NBO) → London (LHR)" in email.body
    assert expected in email.body


@pytest.mark.parametrize(
    ("task", "stale_status"),
    [
        (tasks.notify_admin_new_booking, Status.CANCELLED),
        (tasks.notify_customer_availability_confirmed, Status.PAID),
        (tasks.notify_customer_unavailable, Status.REQUESTED),
        (tasks.notify_customer_payment_received, Status.AVAILABILITY_CONFIRMED),
        (tasks.notify_customer_booking_expired, Status.PAID),
    ],
)
def test_email_tasks_skip_when_state_has_changed(make_booking, task, stale_status):
    booking = make_booking(status=stale_status)
    task(booking.id)
    task(999999)
    assert mail.outbox == []
