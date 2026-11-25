from datetime import timedelta

import pytest
from django.core import mail
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.db import IntegrityError, connection, transaction
from django.utils import timezone

from bookings import tasks as booking_tasks
from bookings.models import BoardingPass, Booking
from core.tests.helpers import OTHER_SCHEMA, TEST_SCHEMA
from customer_requests import tasks as query_tasks
from customer_requests.models import Query
from tenants import services
from tenants.models import MODULES, Tenant
from tenants.tests.test_platform import owner, platform  # noqa: F401 (fixtures)

pytestmark = pytest.mark.django_db

Status = Booking.Status


def tenant(schema=TEST_SCHEMA):
    return Tenant.objects.get(schema_name=schema)


def set_modules(*modules, schema=TEST_SCHEMA):
    Tenant.objects.filter(schema_name=schema).update(**{f"{m}_enabled": m in modules for m in MODULES})


def patch_modules(platform, modules, schema=TEST_SCHEMA):  # noqa: F811
    response = platform.patch(f"/api/platform/tenants/{tenant(schema).pk}", {"modules": modules}, format="json")
    # Platform requests run in the public schema; the test carries on in the agency's.
    connection.set_schema(TEST_SCHEMA)
    return response


@pytest.fixture
def booking(customer, make_offer):
    def make(status=Status.REQUESTED):
        # Signing in to the platform leaves the connection in the public schema.
        connection.set_schema(TEST_SCHEMA)
        offer = make_offer()
        return Booking.objects.create(
            user=customer, offer=offer, status=status, passenger_count=1, unit_price=offer.price
        )

    return make


# The switches


def test_the_database_keeps_at_least_one_module_on():
    with pytest.raises(IntegrityError), transaction.atomic():
        Tenant.objects.filter(schema_name=TEST_SCHEMA).update(flights_enabled=False)


def test_existing_agencies_have_flights_only():
    assert {t.schema_name: t.modules for t in Tenant.objects.filter(schema_name__in=[TEST_SCHEMA, OTHER_SCHEMA])} == {
        TEST_SCHEMA: ["flights"],
        OTHER_SCHEMA: ["flights"],
    }


def test_create_agency_takes_the_modules_or_flights_only():
    common = {"admin_email": "a@new.test", "admin_password": "Str0ng-pass!", "admin_name": "A"}
    assert services.create_agency(slug="plain-one", name="Plain", **common).modules == ["flights"]
    created = services.create_agency(slug="trips-one", name="Trips", modules=["hotels", "tours"], **common)
    assert tenant(created.schema_name).modules == ["tours", "hotels"]
    with pytest.raises(ValidationError) as error:
        services.create_agency(slug="empty-one", name="Empty", modules=[], **common)
    assert error.value.message_dict == {"modules": ["Turn on at least one module."]}


# A module that is off


@pytest.mark.parametrize(
    ("who", "method", "url"),
    [
        # Public
        ("api", "get", "/api/offers"),
        ("api", "get", "/api/offers/{offer}"),
        # Customer
        ("customer_api", "get", "/api/bookings"),
        ("customer_api", "post", "/api/bookings/{booking}/cancel"),
        ("customer_api", "get", "/api/queries"),
        ("customer_api", "get", "/api/boarding-passes/{boarding_pass}/download"),
        # Admin
        ("admin_api", "get", "/api/admin/offers"),
        ("admin_api", "get", "/api/admin/bookings"),
        ("admin_api", "post", "/api/admin/bookings/{booking}/mark-paid"),
        ("admin_api", "get", "/api/admin/queries"),
        ("admin_api", "get", "/api/admin/integrations"),
        ("admin_api", "get", "/api/admin/routes"),
        ("admin_api", "get", "/api/admin/fares"),
        ("admin_api", "get", "/api/admin/search-usage"),
    ],
)
def test_flight_endpoints_answer_module_off_when_flights_is_off(request, booking, who, method, url):
    found = booking(Status.COMPLETED)
    boarding_pass = BoardingPass(booking=found, original_name="pass.pdf")
    boarding_pass.file.save("pass.pdf", ContentFile(b"%PDF-1.4"))
    url = url.format(offer=found.offer_id, booking=found.pk, boarding_pass=boarding_pass.pk)
    client = request.getfixturevalue(who)
    # Answered while flights is on (not always 200: e.g. a completed booking cannot be cancelled).
    assert getattr(client, method)(url).status_code != 404
    set_modules("tours")
    response = getattr(client, method)(url)
    assert response.status_code == 404
    assert response.json() == {"detail": "This part of the site isn't available.", "code": "module_off"}


def test_what_is_always_on_stays_on(api, admin_api, customer_api):
    set_modules("hotels")
    assert api.get("/api/agency").status_code == 200
    assert api.get("/api/airports?search=nai").status_code == 200
    assert customer_api.get("/api/auth/me").status_code == 200
    assert customer_api.get("/api/support/chats").status_code == 200
    assert admin_api.get("/api/admin/settings").status_code == 200
    assert admin_api.get("/api/admin/users").status_code == 200
    assert admin_api.get("/api/admin/dashboard").status_code == 200


def test_another_agencys_modules_do_not_matter(api, make_offer):
    make_offer()
    set_modules("tours", schema=OTHER_SCHEMA)
    assert api.get("/api/offers").status_code == 200


def test_flight_scheduled_tasks_skip_the_agency(booking, django_capture_on_commit_callbacks):
    confirmed = booking(Status.AVAILABILITY_CONFIRMED)
    Booking.objects.filter(pk=confirmed.pk).update(payment_deadline=timezone.now() + timedelta(hours=1))
    stale = booking(Status.AVAILABILITY_CONFIRMED)
    Booking.objects.filter(pk=stale.pk).update(payment_deadline=timezone.now() - timedelta(hours=1))
    set_modules("tours")
    with django_capture_on_commit_callbacks(execute=True):
        assert booking_tasks.expire_unpaid_bookings() == 0
        assert booking_tasks.send_payment_reminders() == 0
        assert booking_tasks.expire_stale_requests() == 0
    assert Booking.objects.get(pk=stale.pk).status == Status.AVAILABILITY_CONFIRMED
    assert Booking.objects.get(pk=confirmed.pk).reminder_sent_at is None
    assert mail.outbox == []


def test_queued_flight_emails_are_dropped(booking, customer, airports):
    paid = booking(Status.PAID)
    query = Query.objects.create(user=customer, origin=airports["NBO"], date_from=timezone.localdate())
    set_modules("tours")
    booking_tasks.notify_customer_payment_received.delay(TEST_SCHEMA, paid.pk)
    query_tasks.notify_admin_new_query.delay(TEST_SCHEMA, query.pk)
    assert mail.outbox == []
    # The same emails go out with flights on.
    set_modules("flights")
    booking_tasks.notify_customer_payment_received.delay(TEST_SCHEMA, paid.pk)
    query_tasks.notify_admin_new_query.delay(TEST_SCHEMA, query.pk)
    assert len(mail.outbox) == 2


# Turning modules on and off


@pytest.mark.parametrize("status", Booking.ACTIVE_STATUSES)
def test_flights_cannot_be_turned_off_with_open_flight_bookings(booking, platform, status):  # noqa: F811
    for _ in range(3):
        booking(status)
    response = patch_modules(platform, ["tours"])
    assert response.status_code == 409
    assert response.data == {"detail": "Flights can't be turned off: 3 open flight bookings."}
    assert tenant().modules == ["flights"]


def test_one_open_booking_is_named_in_the_singular(booking, platform):  # noqa: F811
    booking()
    assert patch_modules(platform, ["hotels"]).data["detail"] == "Flights can't be turned off: 1 open flight booking."


@pytest.mark.parametrize("status", [Status.COMPLETED, Status.CANCELLED, Status.EXPIRED, Status.UNAVAILABLE])
def test_finished_bookings_do_not_stop_turning_flights_off(booking, platform, status):  # noqa: F811
    booking(status)
    response = patch_modules(platform, ["tours"])
    assert response.status_code == 200, response.data
    assert response.data["modules"] == ["tours"]


def test_the_last_module_cannot_be_turned_off(platform):  # noqa: F811
    response = patch_modules(platform, [])
    assert response.status_code == 400
    assert response.data == {"modules": ["Turn on at least one module."]}
    assert patch_modules(platform, ["cruises"]).status_code == 400
    assert tenant().modules == ["flights"]


def test_turning_a_module_on_is_always_allowed(booking, platform):  # noqa: F811
    booking()
    response = patch_modules(platform, ["hotels", "flights", "tours", "tours"])
    assert response.status_code == 200
    assert response.data["modules"] == ["flights", "tours", "hotels"]


def test_the_data_is_all_back_when_flights_is_turned_on_again(booking, api, customer_api, platform):  # noqa: F811
    done = booking(Status.COMPLETED)
    assert patch_modules(platform, ["tours"]).status_code == 200
    assert api.get("/api/offers").status_code == 404
    assert Booking.objects.filter(pk=done.pk).exists()
    assert patch_modules(platform, ["flights", "tours"]).status_code == 200
    assert [offer["id"] for offer in api.get("/api/offers").data["results"]] == [str(done.offer_id)]
    assert [row["id"] for row in customer_api.get("/api/bookings").data["results"]] == [str(done.pk)]


# The API fields


def test_agency_and_admin_settings_return_the_modules(api, admin_api):
    set_modules("flights", "hotels")
    assert api.get("/api/agency").data["modules"] == ["flights", "hotels"]
    assert admin_api.get("/api/admin/settings").data["modules"] == ["flights", "hotels"]
    # Read-only for the agency.
    assert admin_api.patch("/api/admin/settings", {"modules": ["tours"]}, format="json").status_code == 200
    assert tenant().modules == ["flights", "hotels"]


def test_platform_tenants_return_the_modules(platform):  # noqa: F811
    set_modules("tours", schema=OTHER_SCHEMA)
    rows = {row["slug"]: row["modules"] for row in platform.get("/api/platform/tenants").data["results"]}
    assert rows == {"test": ["flights"], "other": ["tours"]}
    detail = platform.get(f"/api/platform/tenants/{tenant().pk}").data
    assert detail["modules"] == ["flights"]


def test_the_platform_creates_an_agency_with_modules_or_flights_only(platform):  # noqa: F811
    body = {"admin_name": "Ada", "admin_email": "ada@new.test", "admin_password": "Str0ng-pass!"}
    plain = platform.post("/api/platform/tenants", {"name": "Plain", "slug": "plain-two", **body}, format="json")
    assert plain.status_code == 201, plain.data
    assert plain.data["modules"] == ["flights"]
    body["admin_email"] = "ada@other.test"
    trips = platform.post(
        "/api/platform/tenants",
        {"name": "Trips", "slug": "trips-two", "modules": ["tours"], **body},
        format="json",
    )
    assert trips.status_code == 201, trips.data
    assert trips.data["modules"] == ["tours"]
    empty = platform.post(
        "/api/platform/tenants", {"name": "E", "slug": "empty-two", "modules": [], **body}, format="json"
    )
    assert empty.status_code == 400
    assert empty.data == {"modules": ["Turn on at least one module."]}


def test_agency_admins_cannot_change_modules_on_the_platform(admin_api):
    response = admin_api.patch(f"/api/platform/tenants/{tenant().pk}", {"modules": ["tours"]}, format="json")
    assert response.status_code in (401, 403, 404)
    assert tenant().modules == ["flights"]


# The dashboard


def test_the_dashboard_leaves_out_flight_figures_when_flights_is_off(admin_api, booking):
    booking(Status.PAID)
    with_flights = admin_api.get("/api/admin/dashboard").data
    assert with_flights["sales"]["all_time"]["by_module"] == {"flights": with_flights["sales"]["all_time"]["total"]}
    assert "bookings_requested" in with_flights["needs_action"] and "flights" in with_flights["on_sale"]
    set_modules("tours")
    data = admin_api.get("/api/admin/dashboard").data
    assert data["modules"] == ["tours"]
    assert data["sales"]["all_time"] == {"total": "0.00", "by_module": {"tours": "0.00"}}
    assert data["needs_action"] == {"travellers_missing": 0}
    assert data["payments_due"] == data["this_week"] == data["top_sellers"] == []
    assert set(data["on_sale"]) == {"tours"}
    assert data["customers"] == {"total": 1, "new_this_month": 1}
