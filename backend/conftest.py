import pytest
from django.core.cache import cache
from django.db import connection
from rest_framework.test import APIClient

from accounts.models import User
from config.celery import app as celery_app
from core.tests.helpers import OTHER_DOMAIN, OTHER_SCHEMA, TEST_DOMAIN, TEST_SCHEMA, airline_named, direct_flight


@pytest.fixture(scope="session")
def django_db_setup(django_db_setup, django_db_blocker):
    """Two agencies for the whole session: every test runs in the first; the second is for isolation tests."""
    from tenants.models import Domain, Tenant

    with django_db_blocker.unblock():
        connection.set_schema_to_public()
        for schema_name, domain, name in [
            (TEST_SCHEMA, TEST_DOMAIN, "Test Agency"),
            (OTHER_SCHEMA, OTHER_DOMAIN, "Other Agency"),
        ]:
            tenant = Tenant(schema_name=schema_name, name=name)
            tenant.save(verbosity=0)
            Domain.objects.create(domain=domain, tenant=tenant, is_primary=True)
            # Every agency is also reachable at its app address; the test agency's primary domain is a custom one.
            if domain != f"{schema_name}.localhost":
                Domain.objects.create(domain=f"{schema_name}.localhost", tenant=tenant, is_primary=False)


@pytest.fixture(autouse=True)
def _in_test_tenant():
    """Tests run in the test agency's schema, as requests to its domain (the test client's testserver) do."""
    connection.set_schema(TEST_SCHEMA)
    yield
    connection.set_schema(TEST_SCHEMA)


@pytest.fixture(autouse=True)
def _celery_eager():
    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = True


@pytest.fixture(autouse=True)
def _fast_password_hashing(settings):
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]


@pytest.fixture(autouse=True)
def private_media(tmp_path, monkeypatch):
    """Keeps files that tests store out of the real private_media directory."""
    from core.storage import private_storage

    monkeypatch.setattr(private_storage, "base_location", str(tmp_path))
    monkeypatch.setattr(private_storage, "location", str(tmp_path))
    return tmp_path


@pytest.fixture(autouse=True)
def public_media(tmp_path_factory, monkeypatch):
    """Keeps logos that tests store out of the real media directory."""
    from core.storage import public_storage

    root = tmp_path_factory.mktemp("public_media")
    monkeypatch.setattr(public_storage, "base_location", str(root))
    monkeypatch.setattr(public_storage, "location", str(root))
    return root


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()


@pytest.fixture
def api():
    return APIClient()


@pytest.fixture
def customer(db):
    return User.objects.create_user(
        email="customer@example.com", password="Str0ng-pass!", full_name="Cara Customer", phone="+254700000001"
    )


@pytest.fixture
def admin_user(db):
    return User.objects.create_user(
        email="owner@example.com", password="Str0ng-pass!", full_name="Owner", role=User.Role.ADMIN
    )


@pytest.fixture
def customer_api(customer):
    client = APIClient()
    client.force_authenticate(customer)
    return client


@pytest.fixture
def admin_api(admin_user):
    client = APIClient()
    client.force_authenticate(admin_user)
    return client


@pytest.fixture
def airports(db):
    from airports.models import Airport

    return {
        a.code: a
        for a in Airport.objects.bulk_create(
            [
                Airport(
                    code="NBO",
                    name="Jomo Kenyatta International Airport",
                    city="Nairobi",
                    country="Kenya",
                    country_code="KE",
                ),
                Airport(
                    code="MBA",
                    name="Moi International Airport",
                    city="Mombasa",
                    country="Kenya",
                    country_code="KE",
                ),
                Airport(
                    code="LHR",
                    name="London Heathrow Airport",
                    city="London",
                    country="United Kingdom",
                    country_code="GB",
                ),
                Airport(
                    code="DXB",
                    name="Dubai International Airport",
                    city="Dubai",
                    country="United Arab Emirates",
                    country_code="AE",
                ),
            ]
        )
    }


@pytest.fixture
def make_offer(airports):
    """Creates a bookable public NBO → LHR offer, one direct flight, unless told otherwise."""
    from datetime import timedelta
    from decimal import Decimal

    from django.utils import timezone

    from catalog.models import Offer

    def make(origin="NBO", destination="LHR", **kwargs):
        today = timezone.localdate()
        fields = {
            "departure_date": today + timedelta(days=30),
            "ticket_class": "economy",
            "price": Decimal("650.00"),
            "airline": "Kenya Airways",
            "valid_until": today + timedelta(days=10),
            **kwargs,
        }
        if isinstance(fields["airline"], str):
            fields["airline"] = airline_named(fields["airline"])
        offer = Offer.objects.create(origin=airports[origin], destination=airports[destination], **fields)
        offer.set_segments([direct_flight(offer)])
        return offer

    return make


@pytest.fixture
def other_customer(db):
    return User.objects.create_user(
        email="other@example.com", password="Str0ng-pass!", full_name="Otto Other", phone="+254700000002"
    )


@pytest.fixture
def other_customer_api(other_customer):
    client = APIClient()
    client.force_authenticate(other_customer)
    return client
