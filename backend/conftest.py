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
