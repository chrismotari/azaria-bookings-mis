"""Steps 41 and 49: the agency admin's dashboard across the modules on."""

from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from django_tenants.utils import schema_context
from freezegun import freeze_time
from rest_framework.test import APIClient

from accounts.models import User
from bookings.models import Booking, BookingEvent, BookingSegment, Traveller
from core.models import AppSettings
from core.tests.helpers import OTHER_DOMAIN, OTHER_SCHEMA, TEST_SCHEMA, direct_flight
from customer_requests.models import Query
from hotels import services as hotel_services
from hotels.models import HotelBooking, HotelBookingEvent, HotelBookingRoom
from hotels.tests.conftest import booking_data, make_hotel, rate_of, room  # noqa: F401
from integrations.models import Integration, Route, SearchRun
from tenants.models import Tenant
from tenants.tests.test_dashboard import invoice
from tours.models import TourBooking, TourBookingLine
from tours.tests.conftest import make_tour  # noqa: F401

pytestmark = pytest.mark.django_db

Status = Booking.Status
HotelStatus = HotelBooking.Status
# Nairobi is UTC+3: 2026-02-28 23:30 in Nairobi is still February there.
NOW = "2026-03-10 09:00:00+03:00"
TODAY = date(2026, 3, 10)


def nairobi(*args):
    return timezone.make_aware(datetime(*args))


def modules(*names):
    Tenant.objects.filter(schema_name=TEST_SCHEMA).update(
        **{f"{name}_enabled": name in names for name in ("flights", "tours", "hotels")}
    )


def sell(customer, offer, paid_at, status=Status.PAID, passengers=1, **fields):
    """A flight booking marked paid at paid_at (Nairobi time)."""
    booking = Booking.objects.create(
        user=customer, offer=offer, status=status, passenger_count=passengers, unit_price=offer.price, **fields
    )
    event = BookingEvent.objects.create(
        booking=booking, from_status=Status.AVAILABILITY_CONFIRMED, to_status=Status.PAID
    )
    BookingEvent.objects.filter(pk=event.pk).update(created_at=paid_at)
    return booking


def stay(customer, hotel, status=HotelStatus.PAID, total="300.00", paid_at=None, check_in=None, rooms=1, **fields):
    """A hotel booking of three nights, with its Paid event at paid_at when given."""
    check_in = check_in or TODAY + timedelta(days=20)
    booking = HotelBooking.objects.create(
        hotel=hotel,
        user=customer,
        check_in=check_in,
        check_out=check_in + timedelta(days=3),
        status=status,
        total=Decimal(total),
        **fields,
    )
    rate = rate_of(hotel)
    for _ in range(rooms):
        HotelBookingRoom.objects.create(
            booking=booking,
            room_type=rate.room_type,
            rate=rate,
            room_name="Deluxe Double",
            rate_name=rate.name,
            per_adult_per_night=rate.per_adult_per_night,
            price=Decimal(total) / rooms,
            adults=2,
        )
    if paid_at:
        event = HotelBookingEvent.objects.create(
            booking=booking, from_status=HotelStatus.AVAILABILITY_CONFIRMED, to_status=HotelStatus.PAID
        )
        HotelBookingEvent.objects.filter(pk=event.pk).update(created_at=paid_at)
    return booking


def book_tour(customer, tour, quantity=1, status=TourBooking.Status.CONFIRMED, created_at=None, travellers=0):
    """A booking of quantity units of the tour's first option, made at created_at."""
    option = tour.options.first()
    booking = TourBooking.objects.create(
        tour=tour, user=customer, people=option.people_per_unit * quantity, status=status
    )
    line = TourBookingLine.objects.create(
        booking=booking,
        option=option,
        option_name=option.name,
        unit_price=option.price,
        people_per_unit=option.people_per_unit,
        quantity=quantity,
    )
    for index in range(travellers):
        Traveller.objects.create(tour_line=line, full_name=f"Traveller {index}")
    if created_at:
        TourBooking.objects.filter(pk=booking.pk).update(created_at=created_at)
    return booking


def starting(days):
    """Tour dates starting in days."""
    start = TODAY + timedelta(days=days)
    return {
        "start_date": start,
        "end_date": start + timedelta(days=2),
        "booking_deadline": start,
        "cancellation_deadline": start,
    }


def dashboard(admin_api):
    response = admin_api.get("/api/admin/dashboard")
    assert response.status_code == 200
    return response.json()


# An agency with flights only


@freeze_time(NOW)
def test_an_empty_flights_agency(admin_api):
    data = dashboard(admin_api)
    assert data["modules"] == ["flights"]
    zero = {"total": "0.00", "by_module": {"flights": "0.00"}}
    assert data["sales"] == {"this_month": zero, "this_year": zero, "all_time": zero, "count_this_month": 0}
    assert len(data["sales_by_month"]) == 12
    assert data["sales_by_month"][0] == {"month": "2025-04", "count": 0, **zero}
    assert data["sales_by_month"][-1]["month"] == "2026-03"
    assert data["needs_action"] == {
        "bookings_requested": 0,
        "bookings_paid_awaiting_boarding_pass": 0,
        "open_queries": 0,
        "bookings_awaiting_payment": 0,
        "new_fares": 0,
    }
    assert data["payments_due"] == data["this_week"] == data["top_sellers"] == []
    assert data["customers"] == {"total": 0, "new_this_month": 0}
    assert data["on_sale"] == {
        "flights": {"bookable": 0, "public_bookable": 0, "expiring_soon": 0, "featured": 0, "searches": None}
    }
    assert data["overdue_invoice"] is None


@freeze_time(NOW)
def test_flight_sales_count_paid_and_completed_bookings_by_their_paid_date(admin_api, customer, make_offer):
    offer = make_offer(price=Decimal("500.00"))
    sell(customer, offer, nairobi(2026, 3, 1, 0, 30), passengers=2)  # 1 000, this month (just after midnight)
    sell(customer, offer, nairobi(2026, 3, 5), status=Status.COMPLETED)  # 500, this month
    sell(customer, offer, nairobi(2026, 2, 28, 23, 30))  # 500, last month (still February in Nairobi)
    sell(customer, offer, nairobi(2025, 12, 31, 23, 59))  # 500, last year
    sell(customer, offer, nairobi(2025, 3, 31))  # 500, 13 months ago: only in all time
    for status in [Status.REQUESTED, Status.AVAILABILITY_CONFIRMED, Status.CANCELLED, Status.EXPIRED]:
        Booking.objects.create(user=customer, offer=offer, status=status, passenger_count=1, unit_price=offer.price)

    data = dashboard(admin_api)
    sales = data["sales"]
    assert sales["this_month"] == {"total": "1500.00", "by_module": {"flights": "1500.00"}}
    assert sales["this_year"]["total"] == "2000.00"
    assert sales["all_time"]["total"] == "3000.00"
    assert sales["count_this_month"] == 2
    months = {row["month"]: row for row in data["sales_by_month"]}
    assert months["2026-03"] == {
        "month": "2026-03",
        "total": "1500.00",
        "count": 2,
        "by_module": {"flights": "1500.00"},
    }
    assert months["2026-02"]["total"] == "500.00" and months["2026-02"]["count"] == 1
    assert months["2025-12"]["total"] == "500.00"
    assert "2025-03" not in months


@freeze_time(NOW)
def test_flight_needs_action_counts(admin_api, customer, make_offer):
    offer = make_offer()
    for status in [Status.REQUESTED, Status.REQUESTED, Status.AVAILABILITY_CONFIRMED, Status.PAID]:
        Booking.objects.create(user=customer, offer=offer, status=status, passenger_count=1, unit_price=offer.price)
    Query.objects.create(
        user=customer,
        origin=offer.origin,
        destination=offer.destination,
        date_from=offer.departure_date,
    )
    assert dashboard(admin_api)["needs_action"] == {
        "bookings_requested": 2,
        "bookings_paid_awaiting_boarding_pass": 1,
        "open_queries": 1,
        "bookings_awaiting_payment": 1,
        "new_fares": 0,
    }


@freeze_time(NOW)
def test_customers_and_new_customers_this_month(admin_api, admin_user):
    def user(email, **fields):
        return User.objects.create_user(email=email, password="Str0ng-pass!", full_name=email, **fields)

    user("new@example.com")
    user("inactive@example.com", is_active=False)
    old = user("old@example.com")
    User.objects.filter(pk=old.pk).update(date_joined=nairobi(2026, 2, 28, 23, 0))
    unknown = user("before-step-41@example.com")
    User.objects.filter(pk=unknown.pk).update(date_joined=None)
    user("second-admin@example.com", role=User.Role.ADMIN)

    assert dashboard(admin_api)["customers"] == {"total": 3, "new_this_month": 1}


@freeze_time(NOW)
def test_flights_on_sale(admin_api, make_offer):
    make_offer(valid_until=TODAY + timedelta(days=7), is_featured=True)
    make_offer(valid_until=TODAY + timedelta(days=30), is_public=False, is_featured=True)  # not seen by customers
    make_offer(valid_until=TODAY + timedelta(days=8))
    make_offer(valid_until=TODAY - timedelta(days=1), is_featured=True)  # lapsed
    make_offer(is_active=False)

    assert dashboard(admin_api)["on_sale"]["flights"] == {
        "bookable": 3,
        "public_bookable": 2,
        "expiring_soon": 1,
        "featured": 1,
        "searches": None,
    }


@freeze_time(NOW)
def test_searches_this_month_once_the_agency_has_an_integration(admin_api, airports):
    integration = Integration(provider="duffel", name="Duffel test", mode="test")
    integration.set_credentials({"access_token": "secret"})
    integration.save()
    route = Route.objects.create(origin=airports["NBO"], destination=airports["LHR"])
    window = {"date_from": date(2026, 4, 1), "date_to": date(2026, 4, 7)}
    SearchRun.objects.create(route=route, searches_made=40, **window)
    old = SearchRun.objects.create(route=route, searches_made=500, **window)
    SearchRun.objects.filter(pk=old.pk).update(created_at=nairobi(2026, 2, 28))

    allowance = Tenant.objects.get(schema_name=TEST_SCHEMA).monthly_search_allowance
    assert dashboard(admin_api)["on_sale"]["flights"]["searches"] == {"used": 40, "allowance": allowance}


def test_the_overdue_invoice_notice(admin_api):
    tenant = Tenant.objects.get(schema_name=TEST_SCHEMA)
    invoice(tenant, "100.00", due_on=date(2026, 1, 15))
    with freeze_time("2026-01-20"):
        assert dashboard(admin_api)["overdue_invoice"] == {
            "number": "INV-T-0001",
            "amount": "100.00",
            "currency": "USD",
            "due_on": "2026-01-15",
            "suspends_on": "2026-02-16",
        }
    with freeze_time("2026-01-15"):
        assert dashboard(admin_api)["overdue_invoice"] is None


# Sale rules of tours and hotels


@freeze_time(NOW)
def test_hotel_sales_are_dated_by_their_paid_event_at_the_accepted_total(admin_api, admin_user, customer, make_hotel):
    modules("hotels")
    AppSettings.objects.update(payment_instructions="M-Pesa paybill 123456.")
    hotel = make_hotel()
    booking = hotel_services.create_booking(customer, booking_data(hotel, room(rate_of(hotel))))
    hotel_services.confirm_availability(booking.pk, admin_user, new_total=Decimal("777.00"), note="Peak season")
    hotel_services.accept_changes(booking.pk, customer)
    hotel_services.transition(booking.pk, HotelStatus.PAID, admin_user)
    HotelBookingEvent.objects.filter(booking=booking, to_status=HotelStatus.PAID).update(
        created_at=nairobi(2026, 2, 28, 23, 30)
    )
    stay(customer, hotel, status=HotelStatus.COMPLETED, total="100.00", paid_at=nairobi(2026, 3, 1, 0, 10))
    stay(customer, hotel, status=HotelStatus.AVAILABILITY_CONFIRMED, total="900.00")
    stay(customer, hotel, status=HotelStatus.CANCELLED, total="900.00")

    data = dashboard(admin_api)
    assert data["modules"] == ["hotels"]
    assert data["sales"]["this_month"] == {"total": "100.00", "by_module": {"hotels": "100.00"}}
    assert data["sales"]["this_year"] == {"total": "877.00", "by_module": {"hotels": "877.00"}}
    months = {row["month"]: row for row in data["sales_by_month"]}
    assert months["2026-02"]["total"] == "777.00" and months["2026-02"]["count"] == 1


@freeze_time(NOW)
def test_tour_bookings_count_when_booked_until_cancelled(admin_api, customer, make_tour):
    modules("tours")
    tour = make_tour()
    book_tour(customer, tour, quantity=2, created_at=nairobi(2026, 3, 1, 0, 5))  # 600, this month
    book_tour(customer, tour, created_at=nairobi(2026, 2, 28, 23, 55))  # 300, February in Nairobi
    book_tour(customer, tour, status=TourBooking.Status.COMPLETED, created_at=nairobi(2026, 1, 5))  # 300
    book_tour(customer, tour, quantity=5, status=TourBooking.Status.CANCELLED)

    data = dashboard(admin_api)
    assert data["sales"]["this_month"] == {"total": "600.00", "by_module": {"tours": "600.00"}}
    assert data["sales"]["this_year"]["total"] == "1200.00"
    assert data["sales"]["count_this_month"] == 1
    months = {row["month"]: row for row in data["sales_by_month"]}
    assert months["2026-02"]["total"] == "300.00"

    booking = TourBooking.objects.get(people=2)
    TourBooking.objects.filter(pk=booking.pk).update(status=TourBooking.Status.CANCELLED)
    assert dashboard(admin_api)["sales"]["this_month"]["total"] == "0.00"


@freeze_time(NOW)
def test_by_module_lists_the_modules_on_only(admin_api, customer, make_offer, make_tour, make_hotel):
    modules("flights", "hotels")
    sell(customer, make_offer(price=Decimal("400.00")), nairobi(2026, 3, 2))
    stay(customer, make_hotel(), paid_at=nairobi(2026, 3, 3))
    book_tour(customer, make_tour())

    data = dashboard(admin_api)
    assert data["modules"] == ["flights", "hotels"]
    assert data["sales"]["this_month"] == {"total": "700.00", "by_module": {"flights": "400.00", "hotels": "300.00"}}
    assert data["sales_by_month"][0]["by_module"] == {"flights": "0.00", "hotels": "0.00"}

    modules("flights", "tours", "hotels")
    data = dashboard(admin_api)
    assert data["sales"]["this_month"] == {
        "total": "1000.00",
        "by_module": {"flights": "400.00", "tours": "300.00", "hotels": "300.00"},
    }
    assert data["sales_by_month"][-1]["count"] == 3


# Coming up and top sellers


@freeze_time(NOW)
def test_payments_due_mix_flights_and_hotels_soonest_first_at_most_five(admin_api, customer, make_offer, make_hotel):
    modules("flights", "hotels")
    offer, hotel = make_offer(price=Decimal("400.00")), make_hotel()
    now = timezone.now()

    def flight(hours):
        return Booking.objects.create(
            user=customer,
            offer=offer,
            status=Status.AVAILABILITY_CONFIRMED,
            passenger_count=2,
            unit_price=offer.price,
            payment_deadline=now + timedelta(hours=hours),
        )

    def hotel_due(hours):
        return stay(
            customer, hotel, status=HotelStatus.AVAILABILITY_CONFIRMED, payment_deadline=now + timedelta(hours=hours)
        )

    due = {1: flight(1), 10: hotel_due(10), 20: flight(20), 30: hotel_due(30), 47: flight(47), 48: hotel_due(48)}
    flight(49), hotel_due(49), flight(-1), hotel_due(-1)
    stay(customer, hotel, status=HotelStatus.PAID, payment_deadline=now + timedelta(hours=5))

    rows = dashboard(admin_api)["payments_due"]
    assert [row["id"] for row in rows] == [str(due[hours].id) for hours in [1, 10, 20, 30, 47]]
    assert rows[0] == {
        "kind": "flight",
        "id": str(due[1].id),
        "customer": {"name": "Cara Customer", "email": "customer@example.com"},
        "title": "NBO → LHR",
        "total": "800.00",
        "payment_deadline": rows[0]["payment_deadline"],
    }
    assert rows[1]["kind"] == "hotel" and rows[1]["title"] == "Diani Reef" and rows[1]["total"] == "300.00"
    # Exactly 48 hours away is within the window.
    due[1].delete()
    assert dashboard(admin_api)["payments_due"][-1]["id"] == str(due[48].id)


@freeze_time(NOW)
def test_flight_departures_this_week_use_the_bookings_own_flights(admin_api, customer, make_offer):
    in_window = make_offer(departure_date=TODAY + timedelta(days=7))
    too_late = make_offer(departure_date=TODAY + timedelta(days=8))
    sell(customer, in_window, nairobi(2026, 3, 1))
    sent = sell(customer, in_window, nairobi(2026, 3, 1), status=Status.COMPLETED, passengers=3)
    sell(customer, too_late, nairobi(2026, 3, 1))
    Booking.objects.create(user=customer, offer=in_window, status=Status.REQUESTED, passenger_count=1, unit_price=1)
    # Confirmed with changes: its own first flight leaves today, earlier than its offer.
    moved = sell(customer, too_late, nairobi(2026, 3, 1))
    flight = direct_flight(too_late) | {"departure_date": TODAY, "arrival_date": TODAY}
    BookingSegment.objects.bulk_create(BookingSegment.build([flight], booking=moved))

    rows = dashboard(admin_api)["this_week"]
    assert [row["id"] for row in rows][:1] == [str(moved.id)]
    assert len(rows) == 3
    assert rows[0]["date"] == str(TODAY) and rows[0]["kind"] == "flight" and rows[0]["title"] == "NBO → LHR"
    completed = next(row for row in rows if row["id"] == str(sent.id))
    assert completed["boarding_passes_sent"] is True and completed["passenger_count"] == 3
    assert all(not row["boarding_passes_sent"] for row in rows if row["id"] != str(sent.id))


@freeze_time(NOW)
def test_this_week_mixes_kinds_by_date_then_flights_tours_hotels(
    admin_api, customer, make_offer, make_tour, make_hotel
):
    modules("flights", "tours", "hotels")
    hotel = make_hotel()
    in_three = TODAY + timedelta(days=3)
    checked_in = stay(customer, hotel, status=HotelStatus.COMPLETED, check_in=in_three, rooms=2)
    tour = make_tour(slots=12, **starting(3))
    book_tour(customer, tour, quantity=3, travellers=1)
    book_tour(customer, tour, quantity=2, travellers=2)
    book_tour(customer, tour, status=TourBooking.Status.CANCELLED)
    flight = sell(customer, make_offer(departure_date=in_three), nairobi(2026, 3, 1))
    today_stay = stay(customer, hotel, check_in=TODAY)
    last_day = stay(customer, hotel, check_in=TODAY + timedelta(days=7))
    stay(customer, hotel, check_in=TODAY + timedelta(days=8))
    stay(customer, hotel, status=HotelStatus.REQUESTED, check_in=in_three)
    book_tour(customer, make_tour(title="Later", **starting(8)))
    make_tour(title="Nobody booked", **starting(2))
    cancelled = make_tour(title="Cancelled", cancelled_at=timezone.now(), **starting(2))
    book_tour(customer, cancelled)

    rows = dashboard(admin_api)["this_week"]
    assert [(row["kind"], row["id"]) for row in rows] == [
        ("hotel", str(today_stay.id)),
        ("flight", str(flight.id)),
        ("tour", str(tour.id)),
        ("hotel", str(checked_in.id)),
        ("hotel", str(last_day.id)),
    ]
    assert rows[2] == {
        "kind": "tour",
        "id": str(tour.id),
        "date": str(in_three),
        "title": "Maasai Mara, 3 days",
        "booked": 5,
        "slots": 12,
        "travellers_missing": 2,
    }
    assert rows[3] == {
        "kind": "hotel",
        "id": str(checked_in.id),
        "date": str(in_three),
        "title": "Diani Reef",
        "customer": {"name": "Cara Customer", "email": "customer@example.com"},
        "nights": 3,
        "rooms": 2,
        "voucher_sent": True,
    }
    assert rows[0]["voucher_sent"] is False


@freeze_time(NOW)
def test_this_week_lists_at_most_eight(admin_api, customer, make_hotel):
    modules("hotels")
    hotel = make_hotel()
    for days in range(8, -1, -1):
        stay(customer, hotel, check_in=TODAY + timedelta(days=days))
    rows = dashboard(admin_api)["this_week"]
    assert [row["date"] for row in rows] == [str(TODAY + timedelta(days=days)) for days in range(8)]


@freeze_time(NOW)
def test_top_sellers_mix_routes_tours_and_hotels_by_total(admin_api, customer, make_offer, make_tour, make_hotel):
    modules("flights", "tours", "hotels")
    london = make_offer(price=Decimal("600.00"))
    london_return = make_offer(price=Decimal("900.00"), trip_type="return", return_date=date(2026, 5, 1))
    dubai = make_offer(destination="DXB", price=Decimal("100.00"))
    for _ in range(3):
        sell(customer, dubai, nairobi(2026, 2, 1))  # 300 in three sales
    sell(customer, london, nairobi(2026, 1, 2))
    sell(customer, london, nairobi(2026, 3, 1))  # 1 200
    sell(customer, london_return, nairobi(2026, 3, 2), trip_type="return", return_date=date(2026, 5, 1))  # 900
    sell(customer, london, nairobi(2025, 12, 1))  # last year
    tour = make_tour()
    book_tour(customer, tour, quantity=5)  # 1 500
    book_tour(customer, tour, created_at=nairobi(2025, 12, 31, 23, 59))  # last year
    hotel = make_hotel()
    stay(customer, hotel, total="500.00", paid_at=nairobi(2026, 1, 1, 0, 5))
    stay(customer, hotel, total="500.00", paid_at=nairobi(2026, 2, 1))  # 1 000
    stay(customer, make_hotel(name="Little Lodge"), total="50.00", paid_at=nairobi(2026, 2, 1))

    rows = dashboard(admin_api)["top_sellers"]
    assert rows == [
        {"kind": "tour", "id": str(tour.id), "title": "Maasai Mara, 3 days", "count": 1, "total": "1500.00"},
        {"kind": "flight", "id": None, "title": "NBO → LHR", "count": 2, "total": "1200.00"},
        {"kind": "hotel", "id": str(hotel.id), "title": "Diani Reef", "count": 2, "total": "1000.00"},
        {"kind": "flight", "id": None, "title": "NBO ⇄ LHR", "count": 1, "total": "900.00"},
        {"kind": "flight", "id": None, "title": "NBO → DXB", "count": 3, "total": "300.00"},
    ]


# Needs action and on sale per module


@freeze_time(NOW)
def test_hotel_needs_action(admin_api, customer, make_hotel):
    modules("hotels")
    hotel = make_hotel()
    for status in [HotelStatus.REQUESTED, HotelStatus.REQUESTED, HotelStatus.AVAILABILITY_CONFIRMED]:
        stay(customer, hotel, status=status)
    for status in [HotelStatus.PAID, HotelStatus.COMPLETED, HotelStatus.EXPIRED]:
        stay(customer, hotel, status=status)
    assert dashboard(admin_api)["needs_action"] == {
        "hotel_to_confirm": 2,
        "hotel_awaiting_payment": 1,
        "hotel_vouchers_due": 1,
    }


@freeze_time(NOW)
def test_travellers_missing_on_tours_starting_within_seven_days(admin_api, customer, make_tour):
    modules("tours")
    soon = make_tour(**starting(7))
    book_tour(customer, soon, quantity=2, travellers=1)  # missing one
    book_tour(customer, soon, quantity=2, travellers=2)  # complete
    book_tour(customer, soon, quantity=2, status=TourBooking.Status.CANCELLED)
    book_tour(customer, make_tour(**starting(0)), quantity=1)  # starts today, missing one
    book_tour(customer, make_tour(**starting(8)), quantity=1)  # too late
    book_tour(customer, make_tour(cancelled_at=timezone.now(), **starting(1)), quantity=1)

    assert dashboard(admin_api)["needs_action"] == {"travellers_missing": 2}


@freeze_time(NOW)
def test_tours_on_sale(admin_api, customer, make_tour):
    modules("tours")
    full = make_tour(slots=2, is_featured=True)
    book_tour(customer, full, quantity=2)
    open_tour = make_tour(slots=10, is_featured=True)
    book_tour(customer, open_tour, quantity=3)
    make_tour(slots=5)
    make_tour(slots=7, is_active=False, is_featured=True)
    make_tour(slots=9, **starting(-1))  # started yesterday
    make_tour(slots=4, cancelled_at=timezone.now())

    assert dashboard(admin_api)["on_sale"] == {
        "tours": {"upcoming": 2, "fully_booked": 1, "seats_sold": 5, "seats_total": 17, "featured": 1}
    }


@freeze_time(NOW)
def test_hotels_on_sale(admin_api, make_hotel):
    modules("hotels")
    make_hotel(is_featured=True)  # prices for 60 days
    make_hotel(name="Edge", rates=[{"name": "Room only", "periods": [(0, 30, "100")]}])  # ends on day 30
    make_hotel(name="Covered", rates=[{"name": "Room only", "periods": [(0, 31, "100")]}], is_featured=True)
    make_hotel(name="Closed", is_active=False, is_featured=True)
    make_hotel(name="Ended", rates=[{"name": "Room only", "periods": [(-10, -1, "100")]}])

    assert dashboard(admin_api)["on_sale"] == {"hotels": {"listed": 3, "prices_ending": 1, "featured": 2}}


@freeze_time(NOW)
def test_a_module_turned_off_drops_out_of_every_figure(admin_api, customer, make_offer, make_tour, make_hotel):
    modules("flights", "tours", "hotels")
    hotel = make_hotel()
    stay(customer, hotel, paid_at=nairobi(2026, 3, 2), check_in=TODAY + timedelta(days=2))
    stay(
        customer,
        hotel,
        status=HotelStatus.AVAILABILITY_CONFIRMED,
        payment_deadline=timezone.now() + timedelta(hours=3),
    )
    book_tour(customer, make_tour(**starting(2)))
    sell(customer, make_offer(departure_date=TODAY + timedelta(days=3)), nairobi(2026, 3, 1))

    data = dashboard(admin_api)
    assert {row["kind"] for row in data["this_week"]} == {"flight", "tour", "hotel"}
    assert {row["kind"] for row in data["top_sellers"]} == {"flight", "tour", "hotel"}
    assert set(data["on_sale"]) == {"flights", "tours", "hotels"}

    modules("flights")
    data = dashboard(admin_api)
    assert data["modules"] == ["flights"]
    assert data["sales"]["all_time"] == {"total": "650.00", "by_module": {"flights": "650.00"}}
    assert all(set(row["by_module"]) == {"flights"} for row in data["sales_by_month"])
    assert set(data["needs_action"]) == {
        "bookings_requested",
        "bookings_paid_awaiting_boarding_pass",
        "open_queries",
        "bookings_awaiting_payment",
        "new_fares",
    }
    assert data["payments_due"] == []
    assert [row["kind"] for row in data["this_week"]] == ["flight"]
    assert [row["kind"] for row in data["top_sellers"]] == ["flight"]
    assert set(data["on_sale"]) == {"flights"}

    modules("hotels")
    data = dashboard(admin_api)
    assert data["sales"]["all_time"] == {"total": "300.00", "by_module": {"hotels": "300.00"}}
    assert [row["kind"] for row in data["payments_due"]] == ["hotel"]
    assert "bookings_requested" not in data["needs_action"]


@freeze_time(NOW)
def test_another_agencys_data_never_appears(admin_api, customer, make_offer, make_hotel):
    modules("flights", "hotels")
    sell(customer, make_offer(), nairobi(2026, 3, 1))
    stay(customer, make_hotel(), paid_at=nairobi(2026, 3, 1))
    invoice(Tenant.objects.get(schema_name=OTHER_SCHEMA), "100.00", due_on=date(2026, 1, 15))
    with schema_context(OTHER_SCHEMA):
        admin = User.objects.create_user(
            email="other-admin@example.com", password="Str0ng-pass!", full_name="Other", role=User.Role.ADMIN
        )
    Tenant.objects.filter(schema_name=OTHER_SCHEMA).update(hotels_enabled=True)

    other = APIClient(HTTP_HOST=OTHER_DOMAIN)
    other.force_authenticate(admin)
    data = other.get("/api/admin/dashboard").json()
    assert data["sales"]["all_time"]["total"] == "0.00"
    assert data["this_week"] == [] and data["top_sellers"] == []
    assert data["customers"]["total"] == 0
    assert data["on_sale"]["flights"]["bookable"] == 0
    assert data["on_sale"]["hotels"]["listed"] == 0
    assert data["overdue_invoice"] is not None  # its own
    assert dashboard(admin_api)["overdue_invoice"] is None
    assert dashboard(admin_api)["sales"]["all_time"]["total"] == "950.00"
