import pytest
from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from accounts.models import User

pytestmark = pytest.mark.django_db

REGISTER = {"email": "New@Example.com", "password": "Tr1cky-horse-77", "full_name": "Nia N", "phone": "+254711"}


def test_register_creates_customer_and_returns_tokens(api):
    response = api.post("/api/auth/register", REGISTER, format="json")
    assert response.status_code == 201
    assert {"access", "refresh", "user"} <= response.data.keys()
    assert response.data["user"]["email"] == "new@example.com"
    assert response.data["user"]["role"] == "customer"
    assert User.objects.get(email="new@example.com").role == User.Role.CUSTOMER


def test_register_ignores_role_field(api):
    api.post("/api/auth/register", {**REGISTER, "role": "admin"}, format="json")
    assert User.objects.get(email="new@example.com").role == User.Role.CUSTOMER


def test_register_applies_password_validators(api):
    response = api.post("/api/auth/register", {**REGISTER, "password": "12345678"}, format="json")
    assert response.status_code == 400
    assert "password" in response.data


def test_register_rejects_duplicate_email(api, customer):
    response = api.post("/api/auth/register", {**REGISTER, "email": "CUSTOMER@example.com"}, format="json")
    assert response.status_code == 400
    assert "email" in response.data


@pytest.mark.parametrize("field", ["full_name", "phone", "email", "password"])
def test_register_requires_fields(api, field):
    data = {k: v for k, v in REGISTER.items() if k != field}
    assert api.post("/api/auth/register", data, format="json").status_code == 400


def test_login_refresh_and_me(api, customer):
    response = api.post(
        "/api/auth/login", {"email": "Customer@Example.com", "password": "Str0ng-pass!"}, format="json"
    )
    assert response.status_code == 200
    assert response.data["user"]["email"] == customer.email

    refreshed = api.post("/api/auth/refresh", {"refresh": response.data["refresh"]}, format="json")
    assert refreshed.status_code == 200
    assert "access" in refreshed.data

    api.credentials(HTTP_AUTHORIZATION=f"Bearer {refreshed.data['access']}")
    me = api.get("/api/auth/me")
    assert me.status_code == 200
    assert me.data == {
        "id": customer.id,
        "email": customer.email,
        "full_name": customer.full_name,
        "phone": customer.phone,
        "role": "customer",
    }


def test_login_wrong_password(api, customer):
    response = api.post("/api/auth/login", {"email": customer.email, "password": "nope"}, format="json")
    assert response.status_code == 401


def test_me_requires_auth(api):
    assert api.get("/api/auth/me").status_code == 401


def test_login_is_throttled_per_ip(api, customer):
    for _ in range(10):
        api.post("/api/auth/login", {"email": customer.email, "password": "nope"}, format="json")
    response = api.post("/api/auth/login", {"email": customer.email, "password": "Str0ng-pass!"}, format="json")
    assert response.status_code == 429


def test_register_is_throttled_per_ip(api):
    for i in range(10):
        api.post("/api/auth/register", {**REGISTER, "email": f"u{i}@example.com"}, format="json")
    response = api.post("/api/auth/register", {**REGISTER, "email": "late@example.com"}, format="json")
    assert response.status_code == 429


# Password reset


def _reset_link_parts(body):
    link = next(line for line in body.splitlines() if "/reset-password?" in line)
    query = link.split("?", 1)[1]
    params = dict(part.split("=", 1) for part in query.split("&"))
    return link, params["uid"], params["token"]


def test_password_reset_same_response_for_known_and_unknown(api, customer, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        known = api.post("/api/auth/password-reset", {"email": customer.email}, format="json")
    with django_capture_on_commit_callbacks(execute=True):
        unknown = api.post("/api/auth/password-reset", {"email": "ghost@example.com"}, format="json")
    assert known.status_code == unknown.status_code == 200
    assert known.data == unknown.data
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == [customer.email]


def test_password_reset_email_link(api, customer, settings, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        api.post("/api/auth/password-reset", {"email": customer.email}, format="json")
    link, uid, token = _reset_link_parts(mail.outbox[0].body)
    assert link.startswith(f"{settings.FRONTEND_URL}/reset-password?uid=")
    assert uid == urlsafe_base64_encode(force_bytes(customer.pk))
    assert default_token_generator.check_token(customer, token)


def test_password_reset_confirm_sets_password_and_token_is_single_use(api, customer):
    uid = urlsafe_base64_encode(force_bytes(customer.pk))
    token = default_token_generator.make_token(customer)
    data = {"uid": uid, "token": token, "new_password": "Brand-new-pass-42"}

    response = api.post("/api/auth/password-reset-confirm", data, format="json")
    assert response.status_code == 200
    customer.refresh_from_db()
    assert customer.check_password("Brand-new-pass-42")

    reused = api.post("/api/auth/password-reset-confirm", {**data, "new_password": "Other-pass-99"}, format="json")
    assert reused.status_code == 400
    customer.refresh_from_db()
    assert customer.check_password("Brand-new-pass-42")


@pytest.mark.parametrize("bad", [{"token": "wrong-token"}, {"uid": "bm90LWFuLWlk"}, {"uid": "!!"}])
def test_password_reset_confirm_invalid(api, customer, bad):
    data = {
        "uid": urlsafe_base64_encode(force_bytes(customer.pk)),
        "token": default_token_generator.make_token(customer),
        "new_password": "Brand-new-pass-42",
        **bad,
    }
    assert api.post("/api/auth/password-reset-confirm", data, format="json").status_code == 400
    customer.refresh_from_db()
    assert customer.check_password("Str0ng-pass!")


def test_password_reset_confirm_applies_validators(api, customer):
    data = {
        "uid": urlsafe_base64_encode(force_bytes(customer.pk)),
        "token": default_token_generator.make_token(customer),
        "new_password": "123",
    }
    response = api.post("/api/auth/password-reset-confirm", data, format="json")
    assert response.status_code == 400
    assert "new_password" in response.data


def test_password_reset_task_skips_inactive_user(customer):
    from accounts.tasks import send_password_reset_email

    customer.is_active = False
    customer.save()
    send_password_reset_email(customer.pk)
    assert mail.outbox == []
