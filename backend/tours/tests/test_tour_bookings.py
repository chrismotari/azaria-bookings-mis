import threading
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.core import mail
from django.db import IntegrityError, connection, transaction
from django.utils import timezone
from freezegun import freeze_time

from accounts.models import User
from bookings.models import Traveller
from core.exceptions import Conflict
from core.models import AppSettings
from core.tests.helpers import OTHER_SCHEMA, TEST_SCHEMA, html_part
from tenants.models import Tenant
from tenants.tests.test_modules import patch_modules, set_modules
from tenants.tests.test_platform import owner, platform  # noqa: F401 (fixtures)
from tours import services, tasks
from tours.models import Tour, TourBooking, TourPriceOption
from tours.tests.conftest import lines

pytestmark = pytest.mark.django_db

NAIROBI = ZoneInfo("Africa/Nairobi")
START = date(2026, 6, 10)


def book(client, tour, *items, **extra):
    return client.post("/api/tour-bookings", {"tour": str(tour.pk), "lines": lines(*items), **extra}, format="json")


@pytest.fixture
def dated_tour(make_tour):
    """Starts 10 June 2026; bookings and free cancellation close 8 June."""

    def make(**overrides):
        fields = {
            "start_date": START,
            "end_date": START + timedelta(days=2),
            "booking_deadline": date(2026, 6, 8),
            "cancellation_deadline": date(2026, 6, 8),
            **overrides,
        }
        return make_tour(**fields)

    return make


# Bookable rules


def test_booking_closes_at_the_end_of_the_deadline_day_in_nairobi(dated_tour, customer_api, api):
    tour = dated_tour()
    with freeze_time(datetime(2026, 6, 8, 23, 59, tzinfo=NAIROBI)):
        assert [row["id"] for row in api.get("/api/tours").data["results"]] == [str(tour.pk)]
        assert book(customer_api, tour, (tour.options.get(), 1)).status_code == 201
    with freeze_time(datetime(2026, 6, 9, 0, 0, tzinfo=NAIROBI)):
        assert api.get("/api/tours").data["results"] == []
        response = book(customer_api, tour, (tour.options.get(), 1))
        assert response.status_code == 409
        assert response.data == {"detail": "Bookings for this tour are closed."}
        detail = customer_api.get(f"/api/tours/{tour.pk}").data
        assert (detail["bookable"], detail["not_bookable_reason"]) == (False, "closed")


def test_a_deadline_on_the_start_day_still_closes_at_the_start(dated_tour, customer_api):
    tour = dated_tour(booking_deadline=START)
    with freeze_time(datetime(2026, 6, 9, 23, 0, tzinfo=NAIROBI)):
        assert book(customer_api, tour, (tour.options.get(), 1)).status_code == 201
    with freeze_time(datetime(2026, 6, 10, 0, 1, tzinfo=NAIROBI)):
        assert book(customer_api, tour, (tour.options.get(), 1)).status_code == 409


def test_the_last_slot(make_tour, customer_api, other_customer_api, api):
    tour = make_tour(slots=3)
    option = tour.options.get()
    assert book(customer_api, tour, (option, 2)).status_code == 201
    response = book(other_customer_api, tour, (option, 2))
    assert response.status_code == 409
    assert response.data == {"detail": "Only 1 slot left."}
    assert book(other_customer_api, tour, (option, 1)).status_code == 201
    response = book(other_customer_api, tour, (option, 1))
    assert response.status_code == 409
    assert response.data == {"detail": "This tour is fully booked."}
    assert [(row["id"], row["bookable"]) for row in api.get("/api/tours").data["results"]] == [(str(tour.pk), False)]
    detail = api.get(f"/api/tours/{tour.pk}").data
    assert (detail["slots_left"], detail["not_bookable_reason"]) == (0, "fully_booked")
    assert Tour.objects.bookable().count() == 0 and Tour.objects.listed().count() == 1


def test_every_limited_option_sold_out_with_slots_left_is_fully_booked(make_tour, customer_api, api):
    tour = make_tour(
        slots=20,
        options=[
            {"name": "VIP", "price": "600", "units_available": 1},
            {"name": "Couple", "price": "900", "people_per_unit": 2, "units_available": 1},
        ],
    )
    vip, couple = tour.options.all()
    assert book(customer_api, tour, (vip, 1), (couple, 1)).status_code == 201
    detail = api.get(f"/api/tours/{tour.pk}").data
    assert (detail["slots_left"], detail["bookable"], detail["not_bookable_reason"]) == (17, False, "fully_booked")
    assert [row["id"] for row in api.get("/api/tours").data["results"]] == [str(tour.pk)]
    assert book(customer_api, tour, (vip, 1)).data == {"detail": "This tour is fully booked."}
    assert not Tour.objects.bookable().exists()
    # An inactive option with units left does not keep the tour open.
    TourPriceOption.objects.create(tour=tour, name="Old", price=1, units_available=5, is_active=False)
    assert not Tour.objects.bookable().exists()
    TourPriceOption.objects.create(tour=tour, name="Regular", price=1)
    assert Tour.objects.bookable().get() == tour


def test_a_cancelled_booking_frees_the_last_slot(make_tour, customer_api, other_customer_api, api):
    tour = make_tour(slots=2)
    booking = book(customer_api, tour, (tour.options.get(), 2)).data
    assert api.get(f"/api/tours/{tour.pk}").data["not_bookable_reason"] == "fully_booked"
    assert customer_api.post(f"/api/tour-bookings/{booking['id']}/cancel").status_code == 200
    detail = api.get(f"/api/tours/{tour.pk}").data
    assert (detail["slots_left"], detail["bookable"], detail["not_bookable_reason"]) == (2, True, None)
    assert book(other_customer_api, tour, (tour.options.get(), 1)).status_code == 201


def test_a_fully_booked_tour_that_closes_or_is_cancelled_is_hidden(dated_tour, customer_api, api):
    tour = dated_tour(slots=1)
    with freeze_time(datetime(2026, 6, 8, 12, 0, tzinfo=NAIROBI)):
        assert book(customer_api, tour, (tour.options.get(), 1)).status_code == 201
        assert len(api.get("/api/tours").data["results"]) == 1
    with freeze_time(datetime(2026, 6, 9, 0, 0, tzinfo=NAIROBI)):
        assert api.get("/api/tours").data["results"] == []
        assert api.get(f"/api/tours/{tour.pk}").status_code == 404
        assert customer_api.get(f"/api/tours/{tour.pk}").data["not_bookable_reason"] == "closed"


def test_the_last_unit_of_a_limited_option(make_tour, customer_api, other_customer_api):
    tour = make_tour(options=[{"name": "VIP", "price": "600", "units_available": 2}, {"name": "Regular", "price": "1"}])
    vip, regular = tour.options.all()
    assert book(customer_api, tour, (vip, 1)).status_code == 201
    assert book(other_customer_api, tour, (vip, 2)).data == {"detail": "Only 1 VIP left."}
    assert book(other_customer_api, tour, (vip, 1)).status_code == 201
    assert book(other_customer_api, tour, (vip, 1)).data == {"detail": "No VIP left."}
    # The tour stays bookable through its other options.
    assert book(other_customer_api, tour, (regular, 1)).status_code == 201
    units = {o["name"]: o["units_left"] for o in other_customer_api.get(f"/api/tours/{tour.pk}").data["options"]}
    assert units == {"VIP": 0, "Regular": None}


@pytest.mark.parametrize(
    ("change", "reason"),
    [({"is_active": False}, "closed"), ({"cancelled_at": timezone.now()}, "cancelled"), ({}, "closed")],
)
def test_inactive_cancelled_or_without_an_active_option_is_not_bookable(make_tour, customer_api, api, change, reason):
    tour = make_tour()
    if change:
        Tour.objects.filter(pk=tour.pk).update(**change)
    else:
        TourPriceOption.objects.filter(tour=tour).update(is_active=False)
    assert api.get("/api/tours").data["results"] == []
    assert api.get(f"/api/tours/{tour.pk}").status_code == 404
    assert book(customer_api, tour, (tour.options.get(), 1)).status_code in (400, 409)


def test_admin_books_past_the_deadline_but_not_from_the_start(dated_tour, admin_api, customer):
    tour = dated_tour()
    data = {"tour": str(tour.pk), "user": str(customer.pk), "lines": lines((tour.options.get(), 1))}
    with freeze_time(datetime(2026, 6, 9, 12, 0, tzinfo=NAIROBI)):
        response = admin_api.post("/api/admin/tour-bookings", data, format="json")
        assert response.status_code == 201, response.data
        assert response.data["created_by"] == "Owner"
    with freeze_time(datetime(2026, 6, 10, 8, 0, tzinfo=NAIROBI)):
        response = admin_api.post("/api/admin/tour-bookings", data, format="json")
        assert response.data == {"detail": "This tour has already started."}
    Tour.objects.filter(pk=tour.pk).update(is_active=False)
    with freeze_time(datetime(2026, 6, 9, 12, 0, tzinfo=NAIROBI)):
        assert admin_api.post("/api/admin/tour-bookings", data, format="json").status_code == 409


def test_admin_books_only_for_an_active_customer(make_tour, admin_api, admin_user, customer):
    tour = make_tour()
    for user in (
        admin_user,
        User.objects.create_user(email="gone@x.test", password="x", full_name="G", is_active=False),
    ):
        data = {"tour": str(tour.pk), "user": str(user.pk), "lines": lines((tour.options.get(), 1))}
        response = admin_api.post("/api/admin/tour-bookings", data, format="json")
        assert response.data == {"user": ["Choose an active customer."]}


# Booking validation


def test_booking_several_options(make_tour, customer_api):
    tour = make_tour(
        options=[{"name": "Regular", "price": "300"}, {"name": "Couple", "price": "500", "people_per_unit": 2}]
    )
    regular, couple = tour.options.all()
    response = book(customer_api, tour, (regular, 1), (couple, 2), group_name="Otieno family", notes="Veg")
    assert response.status_code == 201, response.data
    data = response.data
    assert (data["people"], data["total_price"], data["status"], data["group_name"]) == (
        5,
        "1300.00",
        "confirmed",
        "Otieno family",
    )
    assert [(line["option_name"], line["people"], line["total_price"]) for line in data["lines"]] == [
        ("Regular", 1, "300.00"),
        ("Couple", 4, "1000.00"),
    ]
    assert data["can_cancel"] and data["can_edit_travellers"]
    assert data["payment_instructions"] == "M-Pesa paybill 123456."
    assert [(e["from_status"], e["to_status"]) for e in data["events"]] == [(None, "confirmed")]
    assert customer_api.get(f"/api/tours/{tour.pk}").data["slots_left"] == 5


@pytest.mark.parametrize(
    ("make_lines", "field"),
    [
        (lambda o: [], "lines"),
        (lambda o: [{"option": str(o.pk), "quantity": 0}], "lines"),
        (lambda o: [{"option": str(o.pk), "quantity": 1}] * 2, "lines"),
        (lambda o: [{"option": "00000000-0000-0000-0000-000000000000", "quantity": 1}], "lines"),
    ],
)
def test_lines_are_checked(make_tour, customer_api, make_lines, field):
    tour = make_tour()
    response = customer_api.post(
        "/api/tour-bookings", {"tour": str(tour.pk), "lines": make_lines(tour.options.get())}, format="json"
    )
    assert response.status_code == 400
    assert field in response.data


def test_a_booking_holds_at_most_40_people(make_tour, customer_api):
    tour = make_tour(slots=100, options=[{"name": "Group of 6", "price": "900", "people_per_unit": 6}])
    assert book(customer_api, tour, (tour.options.get(), 7)).data == {"lines": ["A booking holds at most 40 people."]}
    assert book(customer_api, tour, (tour.options.get(), 6)).status_code == 201


def test_an_inactive_option_cannot_be_booked(make_tour, customer_api):
    tour = make_tour(options=[{"name": "Regular", "price": "1"}, {"name": "Off", "price": "1", "is_active": False}])
    assert book(customer_api, tour, (tour.options.get(name="Off"), 1)).status_code == 400


def test_the_bookers_phone_is_needed_and_saved(make_tour, customer_api, customer):
    tour = make_tour()
    User.objects.filter(pk=customer.pk).update(phone="")
    customer.phone = ""
    response = book(customer_api, tour, (tour.options.get(), 1))
    assert response.data == {"phone": ["Add a phone number so the agency can reach you."]}
    assert book(customer_api, tour, (tour.options.get(), 1), phone=" +254711000111 ").status_code == 201
    customer.refresh_from_db()
    assert customer.phone == "+254711000111"


def test_only_customers_book_on_the_customer_endpoint(make_tour, admin_api, api):
    tour = make_tour()
    assert book(admin_api, tour, (tour.options.get(), 1)).status_code == 403
    assert book(api, tour, (tour.options.get(), 1)).status_code == 401


def test_one_customer_may_book_a_tour_twice(make_tour, customer_api):
    tour = make_tour()
    assert book(customer_api, tour, (tour.options.get(), 1)).status_code == 201
    assert book(customer_api, tour, (tour.options.get(), 1), group_name="Second group").status_code == 201


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
@pytest.mark.parametrize("limited", [False, True])
def test_two_bookings_racing_for_the_last_place_only_one_wins(make_tour, customer, other_customer, limited):
    option = {"name": "VIP", "price": "600", "units_available": 1} if limited else {"name": "Regular", "price": "1"}
    AppSettings.objects.get_or_create(defaults={"admin_notification_email": "desk@agency.test"})
    tour = make_tour(slots=5 if limited else 1, options=[option])
    data = {"lines": [{"option": tour.options.get().pk, "quantity": 1, "travellers": []}]}
    barrier = threading.Barrier(2)
    outcomes = []

    def attempt(user):
        connection.set_schema(TEST_SCHEMA)
        barrier.wait()
        try:
            services.book_tour(tour.pk, user, data)
            outcomes.append("booked")
        except Conflict:
            outcomes.append("refused")
        finally:
            connection.close()

    threads = [threading.Thread(target=attempt, args=(user,)) for user in (customer, other_customer)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(outcomes) == ["booked", "refused"]
    assert TourBooking.objects.filter(tour=tour).count() == 1


# Travellers


def traveller(**fields):
    return {"full_name": "Amina Otieno", **fields}


def test_travellers_at_booking_up_to_each_lines_people(make_tour, customer_api):
    tour = make_tour(options=[{"name": "Couple", "price": "500", "people_per_unit": 2}])
    couple = tour.options.get()
    too_many = book(customer_api, tour, (couple, 1, [traveller(), traveller(), traveller()]))
    assert too_many.data == {"lines": ["Couple holds at most 2 travellers."]}
    response = book(customer_api, tour, (couple, 2, [traveller(), traveller(full_name="Baraka Otieno")]))
    assert response.status_code == 201
    assert response.data["travellers_added"] == 2
    assert [t["full_name"] for t in response.data["lines"][0]["travellers"]] == ["Amina Otieno", "Baraka Otieno"]
    assert book(customer_api, tour, (couple, 1)).data["travellers_added"] == 0


@pytest.mark.parametrize(
    ("fields", "field"),
    [
        ({"full_name": "A"}, "full_name"),
        ({"full_name": ""}, "full_name"),
        ({"full_name": "x" * 101}, "full_name"),
        ({"document_type": "passport", "document_number": "A123"}, "document_expiry"),
        ({"document_expiry": "2030-01-01"}, "document_number"),
        ({"document_number": "A123"}, "document_type"),
        ({"document_number": "x" * 31, "document_type": "national_id"}, "document_number"),
        ({"nationality": "KEN"}, "nationality"),
        ({"gender": "other"}, "gender"),
        ({"checked_bags": 6}, "checked_bags"),
        ({"checked_bag_kg": 0}, "checked_bag_kg"),
        ({"special_requests": "x" * 501}, "special_requests"),
        ({"email": "not-an-email"}, "email"),
    ],
)
def test_traveller_fields_are_checked(make_tour, customer_api, fields, field):
    tour = make_tour()
    response = book(customer_api, tour, (tour.options.get(), 1, [traveller(**fields)]))
    assert response.status_code == 400
    assert field in response.data["lines"][0]["travellers"][0]


def test_a_national_id_needs_no_expiry(make_tour, customer_api):
    tour = make_tour()
    full = traveller(
        gender="female",
        date_of_birth="1990-02-03",
        nationality="ke",
        document_type="national_id",
        document_number="12345678",
        email="amina@x.test",
        phone="+254700",
        checked_bags=2,
        checked_bag_kg=20,
        cabin_bag_kg=7,
        special_requests="Vegetarian",
    )
    response = book(customer_api, tour, (tour.options.get(), 1, [full]))
    assert response.status_code == 201, response.data
    assert response.data["lines"][0]["travellers"][0]["nationality"] == "KE"


def test_travellers_added_edited_and_removed_while_confirmed(make_tour, customer_api, admin_api):
    tour = make_tour(options=[{"name": "Couple", "price": "500", "people_per_unit": 2}])
    booking = book(customer_api, tour, (tour.options.get(), 1)).data
    line = booking["lines"][0]["id"]
    url = f"/api/tour-bookings/{booking['id']}/travellers"
    first = customer_api.post(url, {"line": line, **traveller()}, format="json")
    assert first.status_code == 201
    second = admin_api.post(
        f"/api/admin/tour-bookings/{booking['id']}/travellers", {"line": line, "full_name": "Baraka"}, format="json"
    )
    assert second.status_code == 201
    third = customer_api.post(url, {"line": line, "full_name": "Chao"}, format="json")
    assert third.data == {"line": ["Couple holds at most 2 travellers."]}

    edited = customer_api.patch(f"{url}/{first.data['id']}", {"full_name": "Amina W. Otieno"}, format="json")
    assert edited.data["full_name"] == "Amina W. Otieno"
    bad = customer_api.patch(f"{url}/{first.data['id']}", {"document_expiry": "2030-01-01"}, format="json")
    assert bad.status_code == 400
    assert (
        admin_api.delete(f"/api/admin/tour-bookings/{booking['id']}/travellers/{second.data['id']}").status_code == 204
    )
    assert customer_api.get(f"/api/tour-bookings/{booking['id']}").data["travellers_added"] == 1

    customer_api.post(f"/api/tour-bookings/{booking['id']}/cancel")
    assert customer_api.post(url, {"line": line, "full_name": "Late"}, format="json").status_code == 409
    assert customer_api.patch(f"{url}/{first.data['id']}", {"full_name": "Late"}, format="json").status_code == 409
    assert customer_api.delete(f"{url}/{first.data['id']}").status_code == 409


def test_no_email_for_traveller_changes(make_tour, customer_api, django_capture_on_commit_callbacks):
    tour = make_tour()
    booking = book(customer_api, tour, (tour.options.get(), 2)).data
    with django_capture_on_commit_callbacks(execute=True):
        customer_api.post(
            f"/api/tour-bookings/{booking['id']}/travellers",
            {"line": booking["lines"][0]["id"], "full_name": "Amina"},
            format="json",
        )
    assert mail.outbox == []


def test_travellers_are_never_visible_to_other_customers(make_tour, customer_api, other_customer_api):
    tour = make_tour()
    booking = book(customer_api, tour, (tour.options.get(), 1, [traveller()])).data
    traveller_id = booking["lines"][0]["travellers"][0]["id"]
    assert other_customer_api.get(f"/api/tour-bookings/{booking['id']}").status_code == 404
    assert other_customer_api.get("/api/tour-bookings").data["results"] == []
    url = f"/api/tour-bookings/{booking['id']}/travellers"
    assert (
        other_customer_api.post(url, {"line": booking["lines"][0]["id"], "full_name": "X Y"}, format="json").status_code
        == 404
    )
    assert other_customer_api.patch(f"{url}/{traveller_id}", {"full_name": "X Y"}, format="json").status_code == 404
    assert other_customer_api.delete(f"{url}/{traveller_id}").status_code == 404
    assert other_customer_api.get(f"/api/admin/tour-bookings/{booking['id']}").status_code == 403


def test_the_traveller_has_exactly_one_owner(make_tour, customer, make_offer):
    from bookings.models import Booking

    tour = make_tour()
    booking = services.book_tour(tour.pk, customer, {"lines": [{"option": tour.options.get().pk, "quantity": 1}]})
    line = booking.lines.get()
    offer = make_offer()
    flight = Booking.objects.create(user=customer, offer=offer, passenger_count=1, unit_price=offer.price)
    with pytest.raises(IntegrityError), transaction.atomic():
        Traveller.objects.create(full_name="Nobody")
    with pytest.raises(IntegrityError), transaction.atomic():
        Traveller.objects.create(full_name="Both", tour_line=line, booking=flight)
    assert Traveller.objects.create(full_name="On a tour", tour_line=line).pk
    assert Traveller.objects.create(full_name="On a flight", booking=flight).pk


# Cancelling


def test_the_customer_cancels_until_the_end_of_the_cancellation_deadline_day(dated_tour, customer_api):
    tour = dated_tour(booking_deadline=date(2026, 6, 9))
    with freeze_time(datetime(2026, 6, 1, 12, 0, tzinfo=NAIROBI)):
        first = book(customer_api, tour, (tour.options.get(), 2)).data
        second = book(customer_api, tour, (tour.options.get(), 1)).data
    with freeze_time(datetime(2026, 6, 8, 23, 59, tzinfo=NAIROBI)):
        response = customer_api.post(f"/api/tour-bookings/{first['id']}/cancel")
        assert response.status_code == 200
        assert (response.data["status"], response.data["cancelled_by"]) == ("cancelled", "customer")
        assert customer_api.get(f"/api/tours/{tour.pk}").data["slots_left"] == 9
        assert customer_api.post(f"/api/tour-bookings/{first['id']}/cancel").status_code == 409
    with freeze_time(datetime(2026, 6, 9, 0, 0, tzinfo=NAIROBI)):
        assert customer_api.get(f"/api/tour-bookings/{second['id']}").data["can_cancel"] is False
        response = customer_api.post(f"/api/tour-bookings/{second['id']}/cancel")
        assert response.data == {"detail": "The free cancellation period for this tour has ended."}


def test_admin_cancels_with_and_without_a_message(
    make_tour, customer_api, admin_api, django_capture_on_commit_callbacks
):
    tour = make_tour(options=[{"name": "VIP", "price": "600", "units_available": 2}])
    vip = tour.options.get()
    quiet = book(customer_api, tour, (vip, 1)).data
    told = book(customer_api, tour, (vip, 1)).data
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        response = admin_api.post(f"/api/admin/tour-bookings/{quiet['id']}/cancel", {}, format="json")
    assert response.status_code == 200
    assert (response.data["status"], response.data["cancelled_by"], response.data["cancel_reason"]) == (
        "cancelled",
        "admin",
        "",
    )
    assert mail.outbox == []
    with django_capture_on_commit_callbacks(execute=True):
        admin_api.post(
            f"/api/admin/tour-bookings/{told['id']}/cancel", {"message": "Overbooked, sorry."}, format="json"
        )
    [email] = mail.outbox
    assert email.to == ["customer@example.com"]
    assert email.subject == "Your booking was cancelled: Maasai Mara, 3 days"
    assert "Overbooked, sorry." in email.body and "Overbooked, sorry." in html_part(email)
    # Slots and units are free again.
    detail = customer_api.get(f"/api/tours/{tour.pk}").data
    assert (detail["slots_left"], detail["options"][0]["units_left"]) == (10, 2)


def test_admin_cannot_cancel_after_the_tour_ends(make_tour, customer_api, admin_api):
    tour = make_tour()
    booking = book(customer_api, tour, (tour.options.get(), 1)).data
    Tour.objects.filter(pk=tour.pk).update(
        start_date=timezone.localdate() - timedelta(days=3), end_date=timezone.localdate() - timedelta(days=1)
    )
    assert admin_api.post(f"/api/admin/tour-bookings/{booking['id']}/cancel", {}, format="json").status_code == 409


# The completion task and emails


def test_completion_task_with_frozen_time(dated_tour, customer_api):
    tour = dated_tour()
    with freeze_time(datetime(2026, 6, 1, 12, 0, tzinfo=NAIROBI)):
        booking = book(customer_api, tour, (tour.options.get(), 1)).data
    with freeze_time(datetime(2026, 6, 12, 23, 59, tzinfo=NAIROBI)):
        assert tasks.complete_finished_tour_bookings() == 0
    with freeze_time(datetime(2026, 6, 13, 0, 1, tzinfo=NAIROBI)):
        assert tasks.complete_finished_tour_bookings() == 1
        assert tasks.complete_finished_tour_bookings() == 0
    done = TourBooking.objects.get(pk=booking["id"])
    assert done.status == "completed"
    assert list(done.events.values_list("to_status", "actor")) == [("confirmed", done.user_id), ("completed", None)]


def test_booking_emails(make_tour, customer_api, admin_api, customer, django_capture_on_commit_callbacks):
    tour = make_tour(options=[{"name": "Couple", "price": "500", "people_per_unit": 2}])
    with django_capture_on_commit_callbacks(execute=True):
        booking = book(customer_api, tour, (tour.options.get(), 1, [traveller()]), group_name="Otieno family").data
    booked, admin = mail.outbox
    assert booked.to == ["customer@example.com"]
    assert booked.subject == "You're booked: Maasai Mara, 3 days"
    for text in (booked.body, html_part(booked)):
        for expected in [
            "Nairobi CBD",
            "1 × Couple",
            "Otieno family",
            "Amina Otieno",
            "USD 500.00",
            "Full refund until the deadline.",
            "Pay as your agency instructs",
            "M-Pesa paybill 123456.",
        ]:
            assert expected in text, expected
    assert admin.to == ["desk@agency.test"]
    assert admin.subject == "New tour booking from Cara Customer: Maasai Mara, 3 days"
    assert f"/admin/tours/{tour.pk}?booking={booking['id']}" in admin.body

    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        customer_api.post(f"/api/tour-bookings/{booking['id']}/cancel")
    [cancelled] = mail.outbox
    assert cancelled.to == ["desk@agency.test"]
    assert cancelled.subject == "Tour booking cancelled by Cara Customer: Maasai Mara, 3 days"

    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        admin_api.post(
            "/api/admin/tour-bookings",
            {"tour": str(tour.pk), "user": str(customer.pk), "lines": lines((tour.options.get(), 1))},
            format="json",
        )
    # The customer only: no "new booking" email for admin-made bookings.
    assert [m.to for m in mail.outbox] == [["customer@example.com"]]


def test_queued_emails_recheck_the_booking(make_tour, customer, admin_user):
    tour = make_tour()
    booking = services.book_tour(tour.pk, customer, {"lines": [{"option": tour.options.get().pk, "quantity": 1}]})
    mail.outbox.clear()
    TourBooking.objects.filter(pk=booking.pk).update(status="cancelled", cancelled_by="customer")
    tasks.notify_customer_tour_booked.delay(TEST_SCHEMA, booking.pk)
    tasks.notify_admin_new_tour_booking.delay(TEST_SCHEMA, booking.pk)
    tasks.notify_customer_tour_cancelled.delay(TEST_SCHEMA, booking.pk)
    tasks.notify_customer_tour_booking_cancelled.delay(TEST_SCHEMA, booking.pk)
    assert mail.outbox == []


# Visibility, modules and isolation


def test_a_customers_booked_tour_stays_visible_to_them(make_tour, customer_api, other_customer_api, admin_api):
    tour = make_tour()
    book(customer_api, tour, (tour.options.get(), 1))
    admin_api.patch(f"/api/admin/tours/{tour.pk}", {"is_active": False}, format="json")
    assert customer_api.get(f"/api/tours/{tour.pk}").status_code == 200
    assert other_customer_api.get(f"/api/tours/{tour.pk}").status_code == 404
    assert customer_api.get("/api/tours").data["results"] == []


def test_public_list_filters_and_ordering(make_tour, api):
    today = timezone.localdate()
    soon = make_tour(
        title="Diani beach",
        destination="Kwale, Kenya",
        start_date=today + timedelta(days=10),
        booking_deadline=today + timedelta(days=9),
        cancellation_deadline=today + timedelta(days=9),
        end_date=today + timedelta(days=12),
        options=[{"name": "R", "price": "900"}],
    )
    later = make_tour(title="Mara", options=[{"name": "R", "price": "300"}])

    def ids(**params):
        return [row["id"] for row in api.get("/api/tours", params).data["results"]]

    assert ids() == [str(soon.pk), str(later.pk)]
    assert ids(ordering="from_price") == [str(later.pk), str(soon.pk)]
    assert ids(ordering="-from_price") == [str(soon.pk), str(later.pk)]
    assert ids(search="kwale") == [str(soon.pk)]
    assert ids(search="MARA") == [str(later.pk)]
    assert ids(price_min="500") == [str(soon.pk)]
    assert ids(price_max="500") == [str(later.pk)]
    assert ids(date_from=(today + timedelta(days=20)).isoformat()) == [str(later.pk)]
    assert ids(date_to=(today + timedelta(days=20)).isoformat()) == [str(soon.pk)]


@pytest.mark.parametrize(
    ("who", "method", "url"),
    [
        ("api", "get", "/api/tours"),
        ("api", "get", "/api/tours/{tour}"),
        ("customer_api", "get", "/api/tour-bookings"),
        ("customer_api", "get", "/api/tour-bookings/{booking}"),
        ("customer_api", "post", "/api/tour-bookings/{booking}/travellers"),
        ("admin_api", "get", "/api/admin/tours"),
        ("admin_api", "get", "/api/admin/tours/{tour}/notices"),
        ("admin_api", "get", "/api/admin/tour-bookings"),
        ("admin_api", "post", "/api/admin/tour-bookings/{booking}/cancel"),
    ],
)
def test_tour_endpoints_answer_module_off_when_tours_is_off(request, make_tour, customer_api, who, method, url):
    tour = make_tour()
    booking = book(customer_api, tour, (tour.options.get(), 1)).data
    url = url.format(tour=tour.pk, booking=booking["id"])
    client = request.getfixturevalue(who)
    assert getattr(client, method)(url).status_code != 404
    set_modules("flights")
    response = getattr(client, method)(url)
    assert response.status_code == 404
    assert response.json() == {"detail": "This part of the site isn't available.", "code": "module_off"}


def test_tour_emails_and_completion_skip_an_agency_without_tours(make_tour, customer):
    tour = make_tour()
    booking = services.book_tour(tour.pk, customer, {"lines": [{"option": tour.options.get().pk, "quantity": 1}]})
    mail.outbox.clear()
    Tour.objects.filter(pk=tour.pk).update(
        start_date=timezone.localdate() - timedelta(days=3), end_date=timezone.localdate() - timedelta(days=1)
    )
    set_modules("flights")
    tasks.notify_customer_tour_booked.delay(TEST_SCHEMA, booking.pk)
    assert mail.outbox == []
    assert tasks.complete_finished_tour_bookings() == 0
    assert TourBooking.objects.get(pk=booking.pk).status == "confirmed"


def test_tours_cannot_be_turned_off_with_confirmed_bookings_on_a_tour_not_ended(
    make_tour,
    customer,
    platform,  # noqa: F811
):
    connection.set_schema(TEST_SCHEMA)
    tour = make_tour()
    for _ in range(2):
        services.book_tour(tour.pk, customer, {"lines": [{"option": tour.options.get().pk, "quantity": 1}]})
    response = patch_modules(platform, ["flights"])
    assert response.status_code == 409
    assert response.data == {"detail": "Tours can't be turned off: 2 open tour bookings."}
    # Ended today: still open; ended yesterday: not.
    today = timezone.localdate()
    Tour.objects.filter(pk=tour.pk).update(start_date=today - timedelta(days=2), end_date=today)
    assert patch_modules(platform, ["flights"]).status_code == 409
    Tour.objects.filter(pk=tour.pk).update(end_date=today - timedelta(days=1))
    response = patch_modules(platform, ["flights"])
    assert response.status_code == 200, response.data
    assert Tenant.objects.get(schema_name=TEST_SCHEMA).modules == ["flights"]


def test_tours_are_isolated_between_agencies(make_tour, api):
    tour = make_tour()
    Tenant.objects.filter(schema_name=OTHER_SCHEMA).update(tours_enabled=True)
    other = api.get("/api/tours", HTTP_HOST="other.localhost")
    assert other.status_code == 200
    assert other.data["results"] == []
    assert api.get(f"/api/tours/{tour.pk}", HTTP_HOST="other.localhost").status_code == 404
