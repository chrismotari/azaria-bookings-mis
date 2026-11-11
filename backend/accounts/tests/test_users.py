"""The admin's customer management."""

import re

import pytest
from django.core import mail

from accounts import tasks
from accounts.models import User
from bookings.models import Booking
from core.tests.helpers import TEST_SCHEMA, html_part

pytestmark = pytest.mark.django_db

PASSWORD = "Str0ng-pass!"


def new_user(admin_api, capture, **overrides):
    body = {"email": "New.Person@Example.com", "full_name": "New Person", "phone": "+254700000077", **overrides}
    with capture(execute=True):
        return admin_api.post("/api/admin/users", body, format="json")


def set_password_link(email):
    match = re.search(r"http://test.localhost:8081/reset-password\?uid=(\S+)&token=(\S+)", email.body)
    assert match, email.body
    return match.group(1), match.group(2)


def login(api, email, password=PASSWORD):
    return api.post("/api/auth/login", {"email": email, "password": password}, format="json")


def test_only_admins_reach_user_management(api, customer_api, customer):
    for client, code in [(api, 401), (customer_api, 403)]:
        assert client.get("/api/admin/users").status_code == code
        assert client.post("/api/admin/users", {}, format="json").status_code == code
        assert client.get(f"/api/admin/users/{customer.id}").status_code == code
        assert client.patch(f"/api/admin/users/{customer.id}", {}, format="json").status_code == code


def test_lists_customers_or_admins(admin_api, admin_user, customer, other_customer):
    response = admin_api.get("/api/admin/users")
    assert response.status_code == 200
    assert [u["email"] for u in response.data["results"]] == [customer.email, other_customer.email]
    assert response.data["results"][0] == {
        "id": str(customer.id),
        "email": customer.email,
        "full_name": "Cara Customer",
        "phone": "+254700000001",
        "is_active": True,
        "role": "customer",
    }
    second = User.objects.create_user(email="second@example.com", full_name="Second", role=User.Role.ADMIN)
    admins = admin_api.get("/api/admin/users", {"role": "admin"}).data["results"]
    assert [(u["email"], u["role"]) for u in admins] == [("owner@example.com", "admin"), (second.email, "admin")]
    assert admin_api.get("/api/admin/users", {"role": "admin", "search": "second"}).data["count"] == 1
    # An admin opens like a customer.
    assert admin_api.get(f"/api/admin/users/{second.id}").data["role"] == "admin"


@pytest.mark.parametrize(
    ("search", "expected"),
    [
        ("cara", ["customer@example.com"]),
        ("OTHER@", ["other@example.com"]),
        ("0002", ["other@example.com"]),
        ("", ["customer@example.com", "other@example.com"]),
    ],
)
def test_search_on_name_email_and_phone(admin_api, customer, other_customer, search, expected):
    results = admin_api.get("/api/admin/users", {"search": search}).data["results"]
    assert [u["email"] for u in results] == expected


def test_filter_on_active(admin_api, customer, other_customer):
    User.objects.filter(pk=other_customer.pk).update(is_active=False)
    assert [u["email"] for u in admin_api.get("/api/admin/users", {"is_active": "false"}).data["results"]] == [
        other_customer.email
    ]
    assert [u["email"] for u in admin_api.get("/api/admin/users", {"is_active": "true"}).data["results"]] == [
        customer.email
    ]


def test_create_a_customer_who_sets_a_password_from_the_welcome_email(
    admin_api, api, django_capture_on_commit_callbacks
):
    response = new_user(admin_api, django_capture_on_commit_callbacks, role="admin", is_active=False)
    assert response.status_code == 201, response.data
    assert response.data["email"] == "new.person@example.com"
    assert response.data["is_active"] is True
    user = User.objects.get(email="new.person@example.com")
    assert user.role == User.Role.CUSTOMER
    assert not user.has_usable_password()
    assert login(api, user.email).status_code == 401

    [email] = mail.outbox
    assert email.to == ["new.person@example.com"]
    assert "account is ready" in email.subject
    assert "Choose your password" in html_part(email)
    uid, token = set_password_link(email)
    confirmed = api.post(
        "/api/auth/password-reset-confirm", {"uid": uid, "token": token, "new_password": PASSWORD}, format="json"
    )
    assert confirmed.status_code == 200, confirmed.data
    assert login(api, user.email).status_code == 200


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"email": "CUSTOMER@example.com"}, "email"),
        ({"email": "not-an-email"}, "email"),
        ({"email": ""}, "email"),
        ({"full_name": "  "}, "full_name"),
        ({"full_name": ""}, "full_name"),
    ],
)
def test_create_validation(admin_api, customer, django_capture_on_commit_callbacks, overrides, field):
    response = new_user(admin_api, django_capture_on_commit_callbacks, **overrides)
    assert response.status_code == 400
    assert field in response.data
    assert mail.outbox == []


def test_phone_is_optional(admin_api, django_capture_on_commit_callbacks):
    assert new_user(admin_api, django_capture_on_commit_callbacks, phone="").status_code == 201


def test_edit_details(admin_api, customer, other_customer):
    url = f"/api/admin/users/{customer.id}"
    body = {"full_name": "Cara C", "email": "Cara@New.example", "phone": "+254711111111", "role": "admin"}
    response = admin_api.patch(url, body, format="json")
    assert response.status_code == 200, response.data
    customer.refresh_from_db()
    assert (customer.full_name, customer.email, customer.phone, customer.role) == (
        "Cara C",
        "cara@new.example",
        "+254711111111",
        User.Role.CUSTOMER,
    )
    # Its own email again is fine; another customer's is not.
    assert admin_api.patch(url, {"email": "cara@new.example"}, format="json").status_code == 200
    taken = admin_api.patch(url, {"email": other_customer.email.upper()}, format="json")
    assert taken.status_code == 400 and "email" in taken.data
    assert admin_api.delete(url).status_code == 405


def test_deactivated_customers_cannot_sign_in_or_refresh_and_keep_their_bookings(
    admin_api, api, customer, make_offer
):
    offer = make_offer()
    booking = Booking.objects.create(user=customer, offer=offer, passenger_count=1, unit_price=offer.price)
    tokens = login(api, customer.email).data

    response = admin_api.patch(f"/api/admin/users/{customer.id}", {"is_active": False}, format="json")
    assert response.status_code == 200
    assert response.data["is_active"] is False

    assert login(api, customer.email).status_code == 401
    assert api.post("/api/auth/refresh", {"refresh": tokens["refresh"]}, format="json").status_code == 401
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    assert api.get("/api/bookings").status_code == 401
    api.credentials()
    assert Booking.objects.filter(pk=booking.pk, user=customer).exists()
    # Still listed for the admin, and their booking still shows.
    assert admin_api.get(f"/api/admin/bookings/{booking.id}").data["user"]["email"] == customer.email

    assert admin_api.patch(f"/api/admin/users/{customer.id}", {"is_active": True}, format="json").status_code == 200
    assert login(api, customer.email).status_code == 200


def test_welcome_email_is_not_sent_to_a_deactivated_customer(customer):
    User.objects.filter(pk=customer.pk).update(is_active=False)
    tasks.send_account_created_email(TEST_SCHEMA, customer.id)
    assert mail.outbox == []


def test_users_are_managed_per_agency(admin_api, customer):
    from django_tenants.utils import schema_context

    from core.tests.helpers import OTHER_SCHEMA

    with schema_context(OTHER_SCHEMA):
        elsewhere = User.objects.create_user(email="elsewhere@example.com", password=PASSWORD, full_name="E")
    assert admin_api.get(f"/api/admin/users/{elsewhere.id}").status_code == 404
    assert [u["email"] for u in admin_api.get("/api/admin/users").data["results"]] == [customer.email]


def test_making_a_customer_an_admin(admin_api, api, customer, make_offer):
    offer = make_offer()
    booking = Booking.objects.create(user=customer, offer=offer, passenger_count=1, unit_price=offer.price)
    response = admin_api.post(f"/api/admin/users/{customer.id}/make-admin")
    assert response.status_code == 200
    assert response.data["detail"] == "Cara Customer is now an admin."
    customer.refresh_from_db()
    assert customer.role == User.Role.ADMIN
    # Listed with the admins now; their bookings stay theirs.
    assert customer.email not in [u["email"] for u in admin_api.get("/api/admin/users").data["results"]]
    assert customer.email in [u["email"] for u in admin_api.get("/api/admin/users?role=admin").data["results"]]
    assert admin_api.post(f"/api/admin/users/{customer.id}/make-admin").status_code == 404
    assert Booking.objects.filter(pk=booking.pk, user=customer).exists()
    # Their next sign-in is an admin's.
    tokens = login(api, customer.email).data
    assert tokens["user"]["role"] == "admin"
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    assert api.get("/api/admin/users").status_code == 200


def test_a_deactivated_customer_is_not_made_an_admin(admin_api, customer):
    User.objects.filter(pk=customer.pk).update(is_active=False)
    assert admin_api.post(f"/api/admin/users/{customer.id}/make-admin").status_code == 409
    customer.refresh_from_db()
    assert customer.role == User.Role.CUSTOMER


def test_only_admins_make_admins(api, customer_api, customer, other_customer):
    assert api.post(f"/api/admin/users/{customer.id}/make-admin").status_code == 401
    assert customer_api.post(f"/api/admin/users/{other_customer.id}/make-admin").status_code == 403
    other_customer.refresh_from_db()
    assert other_customer.role == User.Role.CUSTOMER


def test_admins_deactivate_other_admins_but_not_themselves(admin_api, admin_user, api):
    second = User.objects.create_user(
        email="second@example.com", password=PASSWORD, full_name="Second", role=User.Role.ADMIN
    )
    response = admin_api.patch(f"/api/admin/users/{admin_user.id}", {"is_active": False}, format="json")
    assert response.status_code == 409
    assert response.data["detail"] == "You cannot deactivate your own account."
    admin_user.refresh_from_db()
    assert admin_user.is_active
    # Their own details can still be edited.
    assert admin_api.patch(f"/api/admin/users/{admin_user.id}", {"phone": "+254700000099"}, format="json").status_code == 200

    assert admin_api.patch(f"/api/admin/users/{second.id}", {"is_active": False, "role": "customer"}, format="json").status_code == 200
    second.refresh_from_db()
    assert (second.is_active, second.role) == (False, User.Role.ADMIN)
    assert login(api, second.email).status_code == 401


@pytest.mark.parametrize("role", [User.Role.CUSTOMER, User.Role.ADMIN])
def test_sending_a_reset_link(admin_api, role, django_capture_on_commit_callbacks):
    user = User.objects.create_user(email="someone@example.com", password=PASSWORD, full_name="Someone", role=role)
    with django_capture_on_commit_callbacks(execute=True):
        response = admin_api.post(f"/api/admin/users/{user.id}/password-reset")
    assert response.status_code == 200
    assert response.data["detail"] == "A reset link has been sent to someone@example.com."
    assert len(mail.outbox) == 1 and mail.outbox[0].to == ["someone@example.com"]
    assert set_password_link(mail.outbox[0])


def test_no_reset_link_for_a_deactivated_user(admin_api, customer, django_capture_on_commit_callbacks):
    User.objects.filter(pk=customer.pk).update(is_active=False)
    with django_capture_on_commit_callbacks(execute=True):
        assert admin_api.post(f"/api/admin/users/{customer.id}/password-reset").status_code == 409
    assert mail.outbox == []


def test_only_admins_send_reset_links(api, customer_api, other_customer):
    assert api.post(f"/api/admin/users/{other_customer.id}/password-reset").status_code == 401
    assert customer_api.post(f"/api/admin/users/{other_customer.id}/password-reset").status_code == 403
