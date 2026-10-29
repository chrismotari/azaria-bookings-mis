import pytest
from django.core.files.base import ContentFile

from accounts.models import User
from core.models import AppSettings
from core.storage import private_storage

pytestmark = pytest.mark.django_db


def test_app_settings_row_seeded(settings):
    app_settings = AppSettings.get()
    assert app_settings.pk == 1
    assert app_settings.admin_notification_email == settings.ADMIN_EMAIL
    assert app_settings.payment_instructions == ""
    assert app_settings.payment_hold_hours == 24
    assert app_settings.reminder_hours_before == 4


def test_private_storage_uses_uuid_names_and_has_no_url(settings, tmp_path):
    settings.PRIVATE_MEDIA_ROOT = tmp_path
    storage = type(private_storage)()
    name = storage.save("boarding_passes/1/My Pass.PDF", ContentFile(b"%PDF-1.4"))
    assert name.startswith("boarding_passes/1/")
    assert name.endswith(".pdf")
    assert "My Pass" not in name
    assert (tmp_path / name).exists()
    with pytest.raises(ValueError):
        storage.url(name)


def test_django_admin_mounted_for_superusers_only(client, customer, admin_user):
    assert client.get("/admin/").status_code == 404

    client.force_login(admin_user)
    assert client.get("/django-admin/").status_code == 302

    staff_only = User.objects.create_user(email="staff@example.com", password="x", full_name="S", is_staff=True)
    client.force_login(staff_only)
    assert client.get("/django-admin/").status_code == 302

    superuser = User.objects.create_superuser(email="root@example.com", password="x", full_name="Root")
    client.force_login(superuser)
    assert client.get("/django-admin/").status_code == 200
