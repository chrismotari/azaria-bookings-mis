import pytest
from django.core.management import CommandError, call_command

from accounts.models import User

pytestmark = pytest.mark.django_db


def test_create_admin():
    call_command("create_admin", email="Owner@Azaria.com", password="Agency-owner-9", name="Azaria Owner")
    user = User.objects.get(email="owner@azaria.com")
    assert user.role == User.Role.ADMIN
    assert user.full_name == "Azaria Owner"
    assert user.check_password("Agency-owner-9")
    assert not user.is_staff and not user.is_superuser


def test_create_admin_rejects_existing_email(customer):
    with pytest.raises(CommandError):
        call_command("create_admin", email=customer.email, password="Agency-owner-9", name="X")


def test_create_admin_validates_password():
    with pytest.raises(CommandError):
        call_command("create_admin", email="a@b.com", password="123", name="X")
    assert not User.objects.exists()
