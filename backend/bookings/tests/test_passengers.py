"""Flight passenger details: required at booking, edited within the status rules, named in emails."""

from datetime import date, time, timedelta

import pytest
from django.core import mail
from django.core.files.base import ContentFile
from django.utils import timezone
from django_tenants.utils import schema_context
from freezegun import freeze_time
from rest_framework.test import APIClient

from accounts.models import User
from bookings import tasks
from bookings.models import BoardingPass, Booking, Traveller
from bookings.services import transition
from core.models import AppSettings
from core.tests.helpers import OTHER_DOMAIN, OTHER_SCHEMA, TEST_SCHEMA, direct_flight, html_part, passengers

pytestmark = pytest.mark.django_db

Status = Booking.Status


@pytest.fixture(autouse=True)
def payment_instructions(db):
    AppSettings.objects.update(payment_instructions="M-Pesa paybill 123456.")


@pytest.fixture
def offer(make_offer):
    return make_offer()


def book(client, offer, travellers, count=None, path="/api/bookings", **extra):
    body = {"offer": str(offer.id), "passenger_count": len(travellers) if count is None else count, **extra}
    if travellers is not None:
        body["travellers"] = travellers
    return client.post(path, body, format="json")


@pytest.fixture
def booked(customer_api, offer):
    """A requested booking for two passengers, made through the API."""
    response = book(customer_api, offer, passengers(2))
    assert response.status_code == 201, response.data
    return Booking.objects.get(pk=response.data["id"])


# Creation


def test_customer_books_with_passengers(customer_api, offer):
    travellers = passengers(3)
    travellers[1].update(document_type="national_id", document_number="12345678", document_expiry=None)
    response = book(customer_api, offer, travellers)
    assert response.status_code == 201, response.data
    assert [t["full_name"] for t in response.data["travellers"]] == [
        "Passenger Number 1",
        "Passenger Number 2",
        "Passenger Number 3",
    ]
    assert response.data["can_edit_travellers"] is True
    booking = Booking.objects.get(pk=response.data["id"])
    assert booking.travellers.count() == 3
    assert isinstance(booking.travellers.first().pk, type(booking.pk))


@pytest.mark.parametrize("travellers", [None, []])
def test_create_refused_without_passengers(customer_api, offer, travellers):
    response = book(customer_api, offer, travellers, count=1)
    assert response.status_code == 400
    assert "travellers" in response.data
    assert not Booking.objects.exists()


@pytest.mark.parametrize("given", [1, 3])
def test_create_refused_with_the_wrong_number(customer_api, offer, given):
    response = book(customer_api, offer, passengers(given), count=2)
    assert response.status_code == 400
    assert response.data["travellers"] == ["Enter the details of all 2 passengers."]
    assert not Booking.objects.exists()


@pytest.mark.parametrize(
    "field", ["full_name", "gender", "date_of_birth", "nationality", "document_type", "document_number"]
)
def test_create_refused_with_a_missing_required_field(customer_api, offer, field):
    travellers = passengers(2)
    del travellers[1][field]
    response = book(customer_api, offer, travellers)
    assert response.status_code == 400
    assert list(response.data["travellers"]) == [1]
    assert field in response.data["travellers"][1]
    assert not Booking.objects.exists() and not Traveller.objects.exists()


@pytest.mark.parametrize("blank", ["", None])
def test_a_passport_needs_its_expiry(customer_api, offer, blank):
    response = book(customer_api, offer, passengers(1, document_expiry=blank))
    assert response.status_code == 400
    assert "document_expiry" in response.data["travellers"][0]


def test_optional_fields_may_be_given(customer_api, offer):
    travellers = passengers(
        1,
        email="p@example.com",
        phone="+254711000000",
        checked_bags=2,
        checked_bag_kg=23,
        cabin_bag_kg=7,
        special_requests="Vegetarian meal",
    )
    response = book(customer_api, offer, travellers)
    assert response.status_code == 201, response.data
    [saved] = response.data["travellers"]
    assert (saved["checked_bags"], saved["checked_bag_kg"], saved["special_requests"]) == (2, 23, "Vegetarian meal")


# Passport expiry against the last flight's date


@pytest.mark.parametrize(("days_after", "ok"), [(-1, False), (0, False), (1, True)])
def test_passport_expiry_against_a_one_way_flight(customer_api, offer, days_after, ok):
    expiry = offer.departure_date + timedelta(days=days_after)
    response = book(customer_api, offer, passengers(2, document_expiry=expiry.isoformat()))
    if ok:
        assert response.status_code == 201, response.data
    else:
        assert response.status_code == 400
        assert response.data["travellers"] == {
            index: {"document_expiry": ["Passport expires before the trip."]} for index in (0, 1)
        }


def test_passport_expiry_against_the_return_flight(customer_api, make_offer):
    offer = make_offer()
    back = offer.departure_date + timedelta(days=14)
    inbound = {
        **direct_flight(offer),
        "direction": "return",
        "origin": offer.destination,
        "destination": offer.origin,
        "departure_date": back,
        "arrival_date": back,
        "departure_time": time(20, 0),
        "arrival_time": time(23, 0),
    }
    offer.trip_type, offer.return_date = "return", back
    offer.save()
    offer.set_segments([direct_flight(offer), inbound])

    response = book(customer_api, offer, passengers(1, document_expiry=back.isoformat()))
    assert response.data["travellers"][0] == {"document_expiry": ["Passport expires before the trip."]}
    response = book(customer_api, offer, passengers(1, document_expiry=(back + timedelta(days=1)).isoformat()))
    assert response.status_code == 201, response.data


def test_a_national_id_needs_no_expiry_and_is_not_checked_against_the_trip(customer_api, offer):
    travellers = passengers(1, document_type="national_id", document_expiry=timezone.localdate().isoformat())
    assert book(customer_api, offer, travellers).status_code == 201


# Date of birth


@freeze_time("2026-03-02 09:00:00+03:00")
@pytest.mark.parametrize(
    ("born", "ok"),
    [
        (date(2026, 3, 2), True),
        (date(2026, 3, 3), False),
        (date(1906, 3, 2), True),
        (date(1906, 3, 1), False),
    ],
)
def test_date_of_birth_limits(customer_api, make_offer, born, ok):
    response = book(customer_api, make_offer(), passengers(1, date_of_birth=born.isoformat()))
    assert (response.status_code == 201) is ok, response.data
    if not ok:
        assert "date_of_birth" in response.data["travellers"][0]


# Admin-made bookings


def test_admin_books_with_passengers(admin_api, customer, offer):
    response = book(admin_api, offer, passengers(2), path="/api/admin/bookings", user=str(customer.id))
    assert response.status_code == 201, response.data
    assert len(response.data["travellers"]) == 2
    assert response.data["can_edit_travellers"] is True
    assert Booking.objects.get(pk=response.data["id"]).travellers.count() == 2


def test_admin_booking_refused_with_the_wrong_number_or_an_incomplete_passenger(admin_api, customer, offer):
    response = book(admin_api, offer, passengers(1), count=2, path="/api/admin/bookings", user=str(customer.id))
    assert response.status_code == 400 and "travellers" in response.data
    response = book(admin_api, offer, passengers(1, nationality=""), path="/api/admin/bookings", user=str(customer.id))
    assert response.status_code == 400
    assert "nationality" in response.data["travellers"][0]
    expiring = passengers(1, document_expiry=offer.departure_date.isoformat())
    response = book(admin_api, offer, expiring, path="/api/admin/bookings", user=str(customer.id))
    assert response.data["travellers"][0] == {"document_expiry": ["Passport expires before the trip."]}
    assert not Booking.objects.exists()


# Edits


def patch(client, booking, traveller, data, admin=False):
    prefix = "/api/admin" if admin else "/api"
    return client.patch(f"{prefix}/bookings/{booking.pk}/travellers/{traveller.pk}", data, format="json")


def set_status(booking, status):
    Booking.objects.filter(pk=booking.pk).update(status=status, payment_deadline=timezone.now() + timedelta(hours=24))


def test_customer_edits_a_passenger_while_requested(customer_api, booked):
    traveller = booked.travellers.first()
    response = patch(customer_api, booked, traveller, {"full_name": "Jane  Wanjiru Otieno", "gender": "female"})
    assert response.status_code == 200, response.data
    assert response.data["full_name"] == "Jane Wanjiru Otieno"
    traveller.refresh_from_db()
    assert traveller.full_name == "Jane Wanjiru Otieno"
    assert mail.outbox == []


@pytest.mark.parametrize("status", [s for s in Status.values if s != Status.REQUESTED])
def test_customer_edits_refused_after_requested(customer_api, booked, status):
    set_status(booked, status)
    traveller = booked.travellers.first()
    response = patch(customer_api, booked, traveller, {"full_name": "Someone Else"})
    assert response.status_code == 409
    traveller.refresh_from_db()
    assert traveller.full_name == "Passenger Number 1"
    detail = customer_api.get(f"/api/bookings/{booked.pk}").data
    assert detail["can_edit_travellers"] is False


@pytest.mark.parametrize("status", [Status.REQUESTED, Status.AVAILABILITY_CONFIRMED, Status.PAID])
def test_admin_edits_until_completed(admin_api, booked, status):
    set_status(booked, status)
    traveller = booked.travellers.last()
    response = patch(admin_api, booked, traveller, {"document_number": "b9876543"}, admin=True)
    assert response.status_code == 200, response.data
    assert response.data["document_number"] == "B9876543"
    assert admin_api.get(f"/api/admin/bookings/{booked.pk}").data["can_edit_travellers"] is True


@pytest.mark.parametrize(
    "status", [Status.COMPLETED, Status.CANCELLED, Status.UNAVAILABLE, Status.EXPIRED, Status.DECLINED]
)
def test_admin_edits_refused_once_finished(admin_api, booked, status):
    set_status(booked, status)
    response = patch(admin_api, booked, booked.travellers.first(), {"full_name": "Someone Else"}, admin=True)
    assert response.status_code == 409
    assert admin_api.get(f"/api/admin/bookings/{booked.pk}").data["can_edit_travellers"] is False


def test_edits_keep_the_required_fields_and_the_passport_rule(customer_api, booked):
    traveller = booked.travellers.first()
    for data in [{"gender": ""}, {"nationality": ""}, {"date_of_birth": None}, {"document_number": ""}]:
        response = patch(customer_api, booked, traveller, data)
        assert response.status_code == 400, data
        assert next(iter(data)) in response.data
    response = patch(customer_api, booked, traveller, {"document_expiry": booked.offer.departure_date.isoformat()})
    assert response.data == {"document_expiry": ["Passport expires before the trip."]}
    born = (timezone.localdate() + timedelta(days=1)).isoformat()
    assert "date_of_birth" in patch(customer_api, booked, traveller, {"date_of_birth": born}).data


def test_there_is_no_add_or_delete(customer_api, admin_api, booked):
    traveller = booked.travellers.first()
    for client, prefix in [(customer_api, "/api"), (admin_api, "/api/admin")]:
        assert client.post(f"{prefix}/bookings/{booked.pk}/travellers/{traveller.pk}", {}).status_code == 405
        assert client.delete(f"{prefix}/bookings/{booked.pk}/travellers/{traveller.pk}").status_code == 405
    assert booked.travellers.count() == 2


# Visibility


def test_only_the_customer_and_admins_see_passengers(customer_api, other_customer_api, admin_api, api, booked):
    traveller = booked.travellers.first()
    assert len(customer_api.get(f"/api/bookings/{booked.pk}").data["travellers"]) == 2
    assert len(admin_api.get(f"/api/admin/bookings/{booked.pk}").data["travellers"]) == 2
    assert admin_api.get(f"/api/admin/bookings/{booked.pk}").data["travellers"][0]["document_number"] == "AK0000001"
    assert other_customer_api.get(f"/api/bookings/{booked.pk}").status_code == 404
    assert patch(other_customer_api, booked, traveller, {"full_name": "Hijack"}).status_code == 404
    assert patch(other_customer_api, booked, traveller, {"full_name": "Hijack"}, admin=True).status_code == 403
    assert patch(api, booked, traveller, {"full_name": "Hijack"}).status_code == 401
    assert patch(admin_api, booked, traveller, {"full_name": "Not mine"}).status_code == 404


def test_a_traveller_of_another_booking_is_not_found(customer_api, booked, make_offer):
    other = book(customer_api, make_offer(), passengers(1)).data
    traveller = booked.travellers.first()
    response = customer_api.patch(
        f"/api/bookings/{other['id']}/travellers/{traveller.pk}", {"full_name": "Swap"}, format="json"
    )
    assert response.status_code == 404


def test_passengers_are_isolated_between_agencies(booked):
    traveller = booked.travellers.first()
    with schema_context(OTHER_SCHEMA):
        admin = User.objects.create_user(
            email="other-admin@example.com", password="Str0ng-pass!", full_name="Other", role=User.Role.ADMIN
        )
    other = APIClient(HTTP_HOST=OTHER_DOMAIN)
    other.force_authenticate(admin)
    assert other.get(f"/api/admin/bookings/{booked.pk}").status_code == 404
    response = patch(other, booked, traveller, {"full_name": "Elsewhere"}, admin=True)
    assert response.status_code == 404
    with schema_context(OTHER_SCHEMA):
        assert not Traveller.objects.exists()


# Old bookings without passengers


def test_old_bookings_without_passengers_keep_working(
    customer, offer, admin_user, customer_api, django_capture_on_commit_callbacks
):
    booking = Booking.objects.create(user=customer, offer=offer, passenger_count=2, unit_price=offer.price)
    data = customer_api.get(f"/api/bookings/{booking.pk}").data
    assert data["travellers"] == [] and data["can_edit_travellers"] is True

    def move(booking_id, to_status, actor):
        with django_capture_on_commit_callbacks(execute=True):
            return transition(booking_id, to_status, actor)

    move(booking.pk, Status.AVAILABILITY_CONFIRMED, admin_user)
    move(booking.pk, Status.PAID, admin_user)
    BoardingPass(booking=booking, original_name="pass.pdf").file.save("pass.pdf", ContentFile(b"%PDF-"))
    assert move(booking.pk, Status.COMPLETED, admin_user).status == Status.COMPLETED
    for to_status, actor in [(Status.CANCELLED, customer), (Status.UNAVAILABLE, admin_user)]:
        other = Booking.objects.create(user=customer, offer=offer, passenger_count=1, unit_price=offer.price)
        assert move(other.pk, to_status, actor).status == to_status
    assert len(mail.outbox) == 4  # confirmed, paid, boarding passes, unavailable
    assert all("Passengers:" not in email.body or "Passengers: 2" in email.body for email in mail.outbox)


# Emails


def test_emails_name_the_passengers_but_never_their_documents(
    customer_api, offer, admin_user, django_capture_on_commit_callbacks
):
    with_extra = passengers(2)
    with_extra[0]["full_name"] = "Jane Wanjiru Otieno"
    with django_capture_on_commit_callbacks(execute=True):
        response = book(customer_api, offer, with_extra)
    booking = Booking.objects.get(pk=response.data["id"])
    with django_capture_on_commit_callbacks(execute=True):
        transition(booking.pk, Status.AVAILABILITY_CONFIRMED, admin_user)
    tasks.notify_customer_payment_reminder(TEST_SCHEMA, booking.pk)
    with django_capture_on_commit_callbacks(execute=True):
        transition(booking.pk, Status.PAID, admin_user)

    assert [email.subject.split(":")[0] for email in mail.outbox] == [
        "New booking from Cara Customer",
        "Seats confirmed",
        "Reminder",
        "Payment received",
    ]
    for email in mail.outbox:
        html = html_part(email)
        for part in (email.body, html):
            assert "Jane Wanjiru Otieno, Passenger Number 2" in part
            assert "AK000000" not in part and "1990-05-17" not in part and "May 1990" not in part
    assert "Passengers: 2 (Jane Wanjiru Otieno, Passenger Number 2)" in mail.outbox[0].body


@pytest.mark.parametrize(
    ("task", "status"),
    [
        (tasks.notify_customer_unavailable, Status.UNAVAILABLE),
        (tasks.notify_customer_booking_expired, Status.EXPIRED),
    ],
)
def test_other_customer_emails_name_the_passengers(booked, task, status):
    set_status(booked, status)
    task(TEST_SCHEMA, booked.pk)
    [email] = mail.outbox
    assert "Passengers: Passenger Number 1, Passenger Number 2" in email.body
    assert "Passenger Number 1, Passenger Number 2" in html_part(email)
    assert "AK0000001" not in email.body


def test_the_boarding_pass_email_names_the_passengers(booked):
    set_status(booked, Status.COMPLETED)
    BoardingPass(booking=booked, original_name="pass.pdf").file.save("pass.pdf", ContentFile(b"%PDF-"))
    tasks.notify_customer_boarding_passes(TEST_SCHEMA, booked.pk)
    [email] = mail.outbox
    assert "Passengers: Passenger Number 1, Passenger Number 2" in email.body
