import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from accounts.models import User
from config.celery import app as celery_app


@pytest.fixture(autouse=True)
def _celery_eager():
    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = True


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
    from catalog.models import Airport

    return {
        a.code: a
        for a in Airport.objects.bulk_create(
            [
                Airport(code="NBO", name="Jomo Kenyatta International Airport", city="Nairobi", country="Kenya"),
                Airport(code="MBA", name="Moi International Airport", city="Mombasa", country="Kenya"),
                Airport(code="LHR", name="London Heathrow Airport", city="London", country="United Kingdom"),
                Airport(code="DXB", name="Dubai International Airport", city="Dubai", country="United Arab Emirates"),
            ]
        )
    }


@pytest.fixture
def make_offering(airports):
    """Creates a bookable public NBO → LHR offering unless told otherwise."""
    from datetime import timedelta
    from decimal import Decimal

    from django.utils import timezone

    from catalog.models import Offering

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
        return Offering.objects.create(origin=airports[origin], destination=airports[destination], **fields)

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
