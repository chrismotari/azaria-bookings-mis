"""Step 41: the agency admin's dashboard figures."""

from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from django_tenants.utils import schema_context
from freezegun import freeze_time
from rest_framework.test import APIClient

from accounts.models import User
from bookings.models import Booking, BookingEvent, BookingSegment
from core.tests.helpers import OTHER_DOMAIN, OTHER_SCHEMA, TEST_SCHEMA, direct_flight
from integrations.models import Integration, Route, SearchRun
from tenants.models import Tenant
from tenants.tests.test_dashboard import invoice

pytestmark = pytest.mark.django_db

Status = Booking.Status
# Nairobi is UTC+3: 2026-03-31 22:30 in Nairobi is still March there but already 19:30 UTC.
NOW = "2026-03-10 09:00:00+03:00"


def nairobi(*args):
    return timezone.make_aware(datetime(*args))


def sell(customer, offer, paid_at, status=Status.PAID, passengers=1, **fields):
    """A booking marked paid at paid_at (Nairobi time)."""
    booking = Booking.objects.create(
        user=customer, offer=offer, status=status, passenger_count=passengers, unit_price=offer.price, **fields
    )
    event = BookingEvent.objects.create(
        booking=booking, from_status=Status.AVAILABILITY_CONFIRMED, to_status=Status.PAID
    )
    BookingEvent.objects.filter(pk=event.pk).update(created_at=paid_at)
    return booking


def dashboard(admin_api):
    response = admin_api.get("/api/admin/dashboard")
    assert response.status_code == 200
    return response.json()


@freeze_time(NOW)
def test_an_empty_agency(admin_api):
    data = dashboard(admin_api)
    assert data["sales"] == {"this_month": "0.00", "this_year": "0.00", "all_time": "0.00", "count_this_month": 0}
    assert len(data["sales_by_month"]) == 12
    assert data["sales_by_month"][0] == {"month": "2025-04", "total": "0.00", "count": 0}
    assert data["sales_by_month"][-1] == {"month": "2026-03", "total": "0.00", "count": 0}
    assert data["payments_due"] == data["departures"] == data["top_routes"] == []
    assert data["customers"] == {"total": 0, "new_this_month": 0}
    assert data["offers"] == {"bookable": 0, "public_bookable": 0, "expiring_soon": 0}
    assert data["searches"] is None
    assert data["overdue_invoice"] is None


@freeze_time(NOW)
def test_sales_count_paid_and_completed_bookings_by_their_paid_date(admin_api, customer, make_offer):
    offer = make_offer(price=Decimal("500.00"))
    sell(customer, offer, nairobi(2026, 3, 1, 0, 30), passengers=2)  # 1 000, this month (just after midnight)
    sell(customer, offer, nairobi(2026, 3, 5), status=Status.COMPLETED)  # 500, this month
    sell(customer, offer, nairobi(2026, 2, 28, 23, 30))  # 500, last month (still February in Nairobi)
    sell(customer, offer, nairobi(2025, 12, 31, 23, 59))  # 500, last year
    sell(customer, offer, nairobi(2025, 3, 31))  # 500, 13 months ago: only in all time
    for status in [Status.REQUESTED, Status.AVAILABILITY_CONFIRMED, Status.CANCELLED, Status.EXPIRED]:
        Booking.objects.create(user=customer, offer=offer, status=status, passenger_count=1, unit_price=offer.price)

    data = dashboard(admin_api)
    assert data["sales"] == {
        "this_month": "1500.00",
        "this_year": "2000.00",
        "all_time": "3000.00",
        "count_this_month": 2,
    }
    months = {row["month"]: row for row in data["sales_by_month"]}
    assert months["2026-03"] == {"month": "2026-03", "total": "1500.00", "count": 2}
    assert months["2026-02"] == {"month": "2026-02", "total": "500.00", "count": 1}
    assert months["2025-12"] == {"month": "2025-12", "total": "500.00", "count": 1}
    assert "2025-03" not in months


@freeze_time(NOW)
def test_payments_due_within_48_hours_soonest_first_at_most_five(admin_api, customer, make_offer):
    offer = make_offer(price=Decimal("400.00"))
    now = timezone.now()

    def awaiting(hours, **fields):
        return Booking.objects.create(
            user=customer,
            offer=offer,
            status=Status.AVAILABILITY_CONFIRMED,
            passenger_count=2,
            unit_price=offer.price,
            payment_deadline=now + timedelta(hours=hours),
            **fields,
        )

    due = {hours: awaiting(hours) for hours in [47, 1, 48, 30, 20, 10, 49, -1]}
    Booking.objects.create(
        user=customer,
        offer=offer,
        status=Status.PAID,
        passenger_count=1,
        unit_price=offer.price,
        payment_deadline=now + timedelta(hours=5),
    )

    rows = dashboard(admin_api)["payments_due"]
    # Six are within 48 hours; the five soonest are listed.
    assert [row["id"] for row in rows] == [str(due[hours].id) for hours in [1, 10, 20, 30, 47]]
    # Exactly 48 hours away is within the window.
    due[1].delete()
    assert dashboard(admin_api)["payments_due"][-1]["id"] == str(due[48].id)
    rows = dashboard(admin_api)["payments_due"]
    assert rows[0]["customer"] == {"name": "Cara Customer", "email": "customer@example.com"}
    assert rows[0]["route"] == {
        "origin": {"code": "NBO", "city": "Nairobi"},
        "destination": {"code": "LHR", "city": "London"},
        "trip_type": "one_way",
    }
    assert rows[0]["total"] == "800.00"


@freeze_time(NOW)
def test_departures_in_the_next_seven_days_use_the_bookings_own_flights(admin_api, customer, make_offer):
    today = timezone.localdate()
    in_window = make_offer(departure_date=today + timedelta(days=7))
    too_late = make_offer(departure_date=today + timedelta(days=8))
    sell(customer, in_window, nairobi(2026, 3, 1))
    sent = sell(customer, in_window, nairobi(2026, 3, 1), status=Status.COMPLETED, passengers=3)
    sell(customer, too_late, nairobi(2026, 3, 1))
    Booking.objects.create(user=customer, offer=in_window, status=Status.REQUESTED, passenger_count=1, unit_price=1)
    # Confirmed with changes: its own first flight leaves today, earlier than its offer.
    moved = sell(customer, too_late, nairobi(2026, 3, 1))
    flight = direct_flight(too_late) | {"departure_date": today, "arrival_date": today}
    BookingSegment.objects.bulk_create(BookingSegment.build([flight], booking=moved))

    rows = dashboard(admin_api)["departures"]
    assert [row["id"] for row in rows][:1] == [str(moved.id)]
    assert len(rows) == 3
    assert rows[0]["departure_date"] == str(today)
    completed = next(row for row in rows if row["id"] == str(sent.id))
    assert completed["boarding_passes_sent"] is True and completed["passenger_count"] == 3
    assert all(not row["boarding_passes_sent"] for row in rows if row["id"] != str(sent.id))


@freeze_time(NOW)
def test_top_routes_this_year_by_route_and_trip_type(admin_api, customer, make_offer):
    london = make_offer(price=Decimal("600.00"))
    london_return = make_offer(price=Decimal("900.00"), trip_type="return", return_date=date(2026, 5, 1))
    dubai = make_offer(destination="DXB", price=Decimal("300.00"))
    for _ in range(3):
        sell(customer, dubai, nairobi(2026, 2, 1))
    sell(customer, london, nairobi(2026, 1, 2))
    sell(customer, london, nairobi(2026, 3, 1))
    sell(customer, london_return, nairobi(2026, 3, 2), trip_type="return", return_date=date(2026, 5, 1))
    sell(customer, london, nairobi(2025, 12, 1))  # last year

    rows = dashboard(admin_api)["top_routes"]
    assert [(row["destination"]["code"], row["trip_type"], row["count"], row["total"]) for row in rows] == [
        ("DXB", "one_way", 3, "900.00"),
        ("LHR", "one_way", 2, "1200.00"),
        ("LHR", "return", 1, "900.00"),
    ]


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
def test_bookable_public_and_expiring_offers(admin_api, make_offer):
    today = timezone.localdate()
    make_offer(valid_until=today + timedelta(days=7))
    make_offer(valid_until=today + timedelta(days=30), is_public=False)
    make_offer(valid_until=today + timedelta(days=8))
    make_offer(valid_until=today - timedelta(days=1))  # lapsed
    make_offer(is_active=False)

    assert dashboard(admin_api)["offers"] == {"bookable": 3, "public_bookable": 2, "expiring_soon": 1}


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
    assert dashboard(admin_api)["searches"] == {"used": 40, "allowance": allowance}


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


@freeze_time(NOW)
def test_another_agencys_data_never_appears(admin_api, customer, make_offer):
    sell(customer, make_offer(), nairobi(2026, 3, 1))
    invoice(Tenant.objects.get(schema_name=OTHER_SCHEMA), "100.00", due_on=date(2026, 1, 15))
    with schema_context(OTHER_SCHEMA):
        admin = User.objects.create_user(
            email="other-admin@example.com", password="Str0ng-pass!", full_name="Other", role=User.Role.ADMIN
        )

    other = APIClient(HTTP_HOST=OTHER_DOMAIN)
    other.force_authenticate(admin)
    data = other.get("/api/admin/dashboard").json()
    assert data["sales"]["all_time"] == "0.00"
    assert data["departures"] == [] and data["top_routes"] == []
    assert data["customers"]["total"] == 0
    assert data["offers"]["bookable"] == 0
    assert data["overdue_invoice"] is not None  # its own
    assert dashboard(admin_api)["overdue_invoice"] is None
    assert dashboard(admin_api)["sales"]["all_time"] == "650.00"
