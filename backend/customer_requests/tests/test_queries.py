from datetime import timedelta

import pytest
from django.core import mail
from django.utils import timezone

from catalog.models import Offering
from core.models import AppSettings
from customer_requests.models import Query, QueryResponse
from customer_requests.tasks import notify_admin_new_query, notify_customer_query_responded

pytestmark = pytest.mark.django_db


def in_days(days):
    return (timezone.localdate() + timedelta(days=days)).isoformat()


@pytest.fixture
def query_payload(airports):
    return {
        "origin": airports["NBO"].id,
        "destination": airports["DXB"].id,
        "date_from": in_days(20),
        "date_to": in_days(40),
        "price_min": "300",
        "price_max": "900.50",
        "ticket_class": "business",
        "max_stopovers": 1,
        "message": "Two adults, flexible on dates.",
    }


@pytest.fixture
def query(customer, airports):
    return Query.objects.create(
        user=customer, origin=airports["NBO"], destination=airports["DXB"], date_from=timezone.localdate()
    )


def new_offering_payload(airports, **overrides):
    return {
        "origin": airports["NBO"].id,
        "destination": airports["DXB"].id,
        "departure_date": in_days(25),
        "ticket_class": "business",
        "price": "880.00",
        "stopovers": 0,
        "airline": "Emirates",
        "valid_until": in_days(5),
        **overrides,
    }


# Access


def test_guests_get_401_on_queries(api, query):
    assert api.get("/api/queries").status_code == 401
    assert api.post("/api/queries", {}, format="json").status_code == 401
    assert api.get(f"/api/queries/{query.id}").status_code == 401
    assert api.post(f"/api/queries/{query.id}/close").status_code == 401


def test_admin_query_endpoints_reject_customers_and_guests(api, customer_api, query):
    for client, code in [(api, 401), (customer_api, 403)]:
        assert client.get("/api/admin/queries").status_code == code
        assert client.get(f"/api/admin/queries/{query.id}").status_code == code
        assert client.post(f"/api/admin/queries/{query.id}/respond", {}, format="json").status_code == code


def test_customers_cannot_read_or_close_other_customers_queries(other_customer_api, query):
    assert other_customer_api.get("/api/queries").data["results"] == []
    assert other_customer_api.get(f"/api/queries/{query.id}").status_code == 404
    assert other_customer_api.post(f"/api/queries/{query.id}/close").status_code == 404
    query.refresh_from_db()
    assert query.status == Query.Status.OPEN


# Create


def test_customer_creates_query_and_admin_is_emailed(
    customer_api, customer, query_payload, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        response = customer_api.post("/api/queries", query_payload, format="json")
    assert response.status_code == 201, response.data
    assert response.data["status"] == "open"
    assert response.data["origin"]["code"] == "NBO"
    query = Query.objects.get(pk=response.data["id"])
    assert query.user == customer

    assert len(mail.outbox) == 1
    email = mail.outbox[0]
    assert email.to == [AppSettings.get().admin_notification_email]
    for expected in [
        "Cara Customer",
        "customer@example.com",
        "Nairobi (NBO) → Dubai (DXB)",
        "USD 300.00 to USD 900.50",
        "Class: Business",
        "Max stopovers: 1",
        "Two adults, flexible on dates.",
        f"/admin/requests/{query.id}",
    ]:
        assert expected in email.body


def test_query_with_destination_only_and_any_class(customer_api, airports):
    response = customer_api.post(
        "/api/queries", {"destination": airports["LHR"].id, "date_from": in_days(3)}, format="json"
    )
    assert response.status_code == 201, response.data
    assert response.data["origin"] is None
    assert response.data["ticket_class"] == ""


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"origin": None, "destination": None}, "destination"),
        ({"date_from": in_days(10), "date_to": in_days(9)}, "date_to"),
        ({"price_min": "500", "price_max": "499.99"}, "price_max"),
        ({"price_min": "-1"}, "price_min"),
        ({"max_stopovers": -1}, "max_stopovers"),
        ({"ticket_class": "cargo"}, "ticket_class"),
        ({"date_from": None}, "date_from"),
    ],
)
def test_query_validation(customer_api, query_payload, overrides, field):
    response = customer_api.post("/api/queries", {**query_payload, **overrides}, format="json")
    assert response.status_code == 400
    assert field in response.data


def test_customer_cannot_set_status_on_create(customer_api, query_payload):
    response = customer_api.post("/api/queries", {**query_payload, "status": "closed"}, format="json")
    assert response.data["status"] == "open"


def test_customer_lists_own_queries(customer_api, query, other_customer, airports):
    Query.objects.create(user=other_customer, destination=airports["LHR"], date_from=timezone.localdate())
    response = customer_api.get("/api/queries")
    assert [q["id"] for q in response.data["results"]] == [query.id]


# Close


def test_customer_closes_own_query(customer_api, query):
    response = customer_api.post(f"/api/queries/{query.id}/close")
    assert response.status_code == 200
    assert response.data["status"] == "closed"
    query.refresh_from_db()
    assert query.status == Query.Status.CLOSED

    assert customer_api.post(f"/api/queries/{query.id}/close").status_code == 409


# Admin list and respond


def test_admin_lists_queries_with_customer_and_status_filter(admin_api, query, other_customer, airports):
    closed = Query.objects.create(
        user=other_customer, destination=airports["LHR"], date_from=timezone.localdate(), status="closed"
    )
    response = admin_api.get("/api/admin/queries")
    assert {q["id"] for q in response.data["results"]} == {query.id, closed.id}
    assert response.data["results"][-1]["user"]["email"] == "customer@example.com"

    assert [q["id"] for q in admin_api.get("/api/admin/queries", {"status": "open"}).data["results"]] == [query.id]
    assert [q["id"] for q in admin_api.get("/api/admin/queries", {"status": "closed"}).data["results"]] == [
        closed.id
    ]


def test_admin_responds_with_existing_and_new_offerings(
    admin_api, query, airports, make_offering, django_capture_on_commit_callbacks
):
    existing = make_offering(destination="DXB")
    payload = {
        "message": "Here are two good options.",
        "offering_ids": [existing.id],
        "new_offerings": [new_offering_payload(airports)],
    }
    with django_capture_on_commit_callbacks(execute=True):
        response = admin_api.post(f"/api/admin/queries/{query.id}/respond", payload, format="json")
    assert response.status_code == 201, response.data
    assert response.data["status"] == "responded"
    [query_response] = response.data["responses"]
    assert query_response["message"] == "Here are two good options."
    assert len(query_response["offerings"]) == 2

    created = Offering.objects.exclude(pk=existing.pk).get()
    assert created.is_public is False
    assert created.airline == "Emirates"
    query.refresh_from_db()
    assert query.status == Query.Status.RESPONDED

    assert len(mail.outbox) == 1
    email = mail.outbox[0]
    assert email.to == ["customer@example.com"]
    assert "Here are two good options." in email.body
    assert "2 options" in email.body
    assert f"/requests/{query.id}" in email.body


def test_admin_may_respond_more_than_once(admin_api, query, make_offering):
    offering = make_offering(destination="DXB")
    for _ in range(2):
        response = admin_api.post(
            f"/api/admin/queries/{query.id}/respond", {"offering_ids": [offering.id]}, format="json"
        )
        assert response.status_code == 201
    assert QueryResponse.objects.filter(query=query).count() == 2


def test_respond_requires_at_least_one_offering(admin_api, query):
    response = admin_api.post(f"/api/admin/queries/{query.id}/respond", {"message": "Sorry"}, format="json")
    assert response.status_code == 400
    query.refresh_from_db()
    assert query.status == Query.Status.OPEN


def test_respond_rejects_unknown_or_unbookable_offerings(admin_api, query, make_offering):
    inactive = make_offering(is_active=False)
    for ids in ([inactive.id], [999999]):
        response = admin_api.post(f"/api/admin/queries/{query.id}/respond", {"offering_ids": ids}, format="json")
        assert response.status_code == 400
        assert "offering_ids" in response.data


def test_respond_is_all_or_nothing_when_a_new_offering_is_invalid(admin_api, query, airports, make_offering):
    existing = make_offering()
    payload = {
        "offering_ids": [existing.id],
        "new_offerings": [
            new_offering_payload(airports),
            new_offering_payload(airports, destination=airports["NBO"].id),
        ],
    }
    response = admin_api.post(f"/api/admin/queries/{query.id}/respond", payload, format="json")
    assert response.status_code == 400
    errors = response.data["new_offerings"]
    assert errors[0] == {}
    assert "destination" in errors[1]
    assert Offering.objects.count() == 1
    assert QueryResponse.objects.count() == 0


def test_respond_to_closed_query_returns_409(admin_api, query, make_offering):
    query.status = Query.Status.CLOSED
    query.save()
    response = admin_api.post(
        f"/api/admin/queries/{query.id}/respond", {"offering_ids": [make_offering().id]}, format="json"
    )
    assert response.status_code == 409
    assert QueryResponse.objects.count() == 0


def test_customer_detail_includes_responses_with_full_offerings(customer_api, admin_api, query, airports):
    admin_api.post(
        f"/api/admin/queries/{query.id}/respond",
        {"message": "Try this", "new_offerings": [new_offering_payload(airports)]},
        format="json",
    )
    response = customer_api.get(f"/api/queries/{query.id}")
    assert response.status_code == 200
    [offering] = response.data["responses"][0]["offerings"]
    assert offering["origin"]["code"] == "NBO"
    assert offering["destination"]["city"] == "Dubai"
    assert offering["airline"] == "Emirates"
    assert offering["is_bookable"] is True


# Visibility of offerings sent in a response


def test_non_public_offering_visible_only_to_the_customer_it_was_sent_to(
    api, customer_api, other_customer_api, admin_api, query, airports
):
    admin_api.post(
        f"/api/admin/queries/{query.id}/respond",
        {"new_offerings": [new_offering_payload(airports)]},
        format="json",
    )
    offering = Offering.objects.get()
    assert customer_api.get(f"/api/offerings/{offering.id}").status_code == 200
    assert other_customer_api.get(f"/api/offerings/{offering.id}").status_code == 404
    assert api.get(f"/api/offerings/{offering.id}").status_code == 404
    # Never listed in browse, not even for the customer it was sent to.
    assert customer_api.get("/api/offerings").data["results"] == []


# Email tasks skip when the state has changed


def test_new_query_email_skipped_when_query_no_longer_open(query):
    query.status = Query.Status.CLOSED
    query.save()
    notify_admin_new_query(query.id)
    assert mail.outbox == []


def test_responded_email_skipped_when_query_closed(query, make_offering):
    response = QueryResponse.objects.create(query=query, message="Hi")
    response.offerings.set([make_offering()])
    query.status = Query.Status.CLOSED
    query.save()
    notify_customer_query_responded(response.id)
    assert mail.outbox == []


def test_email_tasks_ignore_missing_objects():
    notify_admin_new_query(999999)
    notify_customer_query_responded(999999)
    assert mail.outbox == []
