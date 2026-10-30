from datetime import timedelta

import pytest
from django.core import mail
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from bookings import tasks
from bookings.models import BoardingPass, Booking
from bookings.services import InvalidTransition, transition

pytestmark = pytest.mark.django_db

Status = Booking.Status

PDF = b"%PDF-1.4\n%boarding pass\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 16


def upload(name="pass.pdf", content=PDF, content_type="application/pdf"):
    return SimpleUploadedFile(name, content, content_type=content_type)


@pytest.fixture
def make_booking(customer, make_offer):
    offer = make_offer()

    def make(status=Status.PAID, user=None):
        fields = {}
        if status == Status.AVAILABILITY_CONFIRMED:
            fields["payment_deadline"] = timezone.now() + timedelta(hours=24)
        return Booking.objects.create(
            user=user or customer, offer=offer, passenger_count=2, unit_price=offer.price, status=status, **fields
        )

    return make


@pytest.fixture
def add_pass():
    def add(booking, name="pass.pdf", content=PDF):
        boarding_pass = BoardingPass(booking=booking, original_name=name)
        boarding_pass.file.save(name, ContentFile(content), save=True)
        return boarding_pass

    return add


def post_file(client, booking, file):
    return client.post(f"/api/admin/bookings/{booking.id}/boarding-passes", {"file": file}, format="multipart")


# Upload


@pytest.mark.parametrize(
    ("name", "content", "content_type"),
    [("Pass 1.PDF", PDF, "application/pdf"), ("pass.png", PNG, "image/png"), ("pass.jpeg", JPEG, "image/jpeg")],
)
def test_admin_uploads_pdf_png_or_jpeg_while_paid(admin_api, make_booking, private_media, name, content, content_type):
    booking = make_booking()
    response = post_file(admin_api, booking, upload(name, content, content_type))
    assert response.status_code == 201, response.data
    assert response.data["original_name"] == name

    boarding_pass = BoardingPass.objects.get(pk=response.data["id"])
    assert boarding_pass.file.name.startswith(f"boarding_passes/{booking.id}/")
    assert name not in boarding_pass.file.name
    assert (private_media / boarding_pass.file.name).read_bytes() == content


@pytest.mark.parametrize("status", [s for s in Status.values if s != Status.PAID])
def test_upload_refused_unless_paid(admin_api, make_booking, status):
    booking = make_booking(status=status)
    response = post_file(admin_api, booking, upload())
    assert response.status_code == 409
    assert not BoardingPass.objects.exists()


@pytest.mark.parametrize(
    ("name", "content", "content_type"),
    [
        ("pass.txt", b"hello", "text/plain"),
        ("pass.gif", b"GIF89a", "image/gif"),
        ("pass.pdf", PDF, "text/plain"),
        ("pass.pdf", b"not really a pdf", "application/pdf"),
        ("pass.png", JPEG, "image/png"),
        ("pass", PDF, "application/pdf"),
    ],
)
def test_upload_rejects_wrong_type(admin_api, make_booking, name, content, content_type):
    booking = make_booking()
    response = post_file(admin_api, booking, upload(name, content, content_type))
    assert response.status_code == 400
    assert "file" in response.data
    assert not BoardingPass.objects.exists()


def test_upload_rejects_oversize_file(admin_api, make_booking):
    booking = make_booking()
    too_big = PDF + b"0" * (5 * 1024 * 1024)
    response = post_file(admin_api, booking, upload(content=too_big))
    assert response.status_code == 400
    assert "5 MB" in response.data["file"][0]

    exactly_5_mb = PDF + b"0" * (5 * 1024 * 1024 - len(PDF))
    assert post_file(admin_api, booking, upload(content=exactly_5_mb)).status_code == 201


def test_upload_rejects_the_eleventh_file(admin_api, make_booking):
    booking = make_booking()
    for number in range(10):
        assert post_file(admin_api, booking, upload(f"pass-{number}.pdf")).status_code == 201
    response = post_file(admin_api, booking, upload("pass-11.pdf"))
    assert response.status_code == 400
    assert "at most 10" in response.data["file"]
    assert booking.boarding_passes.count() == 10


def test_upload_requires_a_file(admin_api, make_booking):
    response = admin_api.post(f"/api/admin/bookings/{make_booking().id}/boarding-passes", {}, format="multipart")
    assert response.status_code == 400


def test_boarding_pass_endpoints_reject_customers_and_guests(api, customer_api, make_booking, add_pass):
    booking = make_booking()
    boarding_pass = add_pass(booking)
    for client, code in [(api, 401), (customer_api, 403)]:
        assert post_file(client, booking, upload()).status_code == code
        assert client.delete(f"/api/admin/boarding-passes/{boarding_pass.id}").status_code == code
        assert client.post(f"/api/admin/bookings/{booking.id}/complete").status_code == code
    assert api.get(f"/api/boarding-passes/{boarding_pass.id}/download").status_code == 401
    assert BoardingPass.objects.count() == 1


# Delete


def test_delete_removes_the_file_from_disk(admin_api, make_booking, add_pass, private_media, django_capture_on_commit_callbacks):
    boarding_pass = add_pass(make_booking())
    path = private_media / boarding_pass.file.name
    assert path.exists()
    with django_capture_on_commit_callbacks(execute=True):
        response = admin_api.delete(f"/api/admin/boarding-passes/{boarding_pass.id}")
    assert response.status_code == 204
    assert not BoardingPass.objects.exists()
    assert not path.exists()


def test_delete_refused_once_completed(admin_api, make_booking, add_pass, private_media):
    boarding_pass = add_pass(make_booking(status=Status.COMPLETED))
    response = admin_api.delete(f"/api/admin/boarding-passes/{boarding_pass.id}")
    assert response.status_code == 409
    assert BoardingPass.objects.exists()
    assert (private_media / boarding_pass.file.name).exists()


# Completion ("send boarding passes")


def test_complete_fails_without_boarding_passes(admin_api, make_booking):
    booking = make_booking()
    response = admin_api.post(f"/api/admin/bookings/{booking.id}/complete")
    assert response.status_code == 409
    assert "boarding pass" in response.data["detail"]
    booking.refresh_from_db()
    assert booking.status == Status.PAID


def test_complete_sends_every_file_attached(
    admin_api, make_booking, add_pass, django_capture_on_commit_callbacks
):
    booking = make_booking()
    add_pass(booking, "Cara.pdf", PDF)
    add_pass(booking, "Otto.png", PNG)
    with django_capture_on_commit_callbacks(execute=True):
        response = admin_api.post(f"/api/admin/bookings/{booking.id}/complete")
    assert response.status_code == 200, response.data
    assert response.data["status"] == "completed"
    assert [p["original_name"] for p in response.data["boarding_passes"]] == ["Cara.pdf", "Otto.png"]

    [email] = mail.outbox
    assert email.to == ["customer@example.com"]
    assert email.attachments == [("Cara.pdf", PDF, "application/pdf"), ("Otto.png", PNG, "image/png")]
    assert "Nairobi (NBO) → London (LHR)" in email.body
    assert "are attached" in email.body
    assert f"/bookings/{booking.id}" in email.body


def test_completion_email_skipped_unless_completed(make_booking, add_pass):
    booking = make_booking()
    add_pass(booking)
    tasks.notify_customer_boarding_passes(booking.id)
    tasks.notify_customer_boarding_passes(999999)
    assert mail.outbox == []


def test_complete_by_customer_is_refused(customer, make_booking, add_pass):
    booking = make_booking()
    add_pass(booking)
    with pytest.raises(InvalidTransition):
        transition(booking.id, Status.COMPLETED, customer)


# Visibility and download


def test_customer_cannot_see_or_download_passes_before_completion(customer_api, make_booking, add_pass):
    booking = make_booking()
    boarding_pass = add_pass(booking)
    response = customer_api.get(f"/api/bookings/{booking.id}")
    assert "boarding_passes" not in response.data
    assert customer_api.get(f"/api/boarding-passes/{boarding_pass.id}/download").status_code == 404


def test_customer_sees_and_downloads_passes_after_completion(customer_api, make_booking, add_pass):
    booking = make_booking(status=Status.COMPLETED)
    boarding_pass = add_pass(booking, "My pass.pdf")
    response = customer_api.get(f"/api/bookings/{booking.id}")
    assert [p["original_name"] for p in response.data["boarding_passes"]] == ["My pass.pdf"]

    response = customer_api.get(f"/api/boarding-passes/{boarding_pass.id}/download")
    assert response.status_code == 200
    assert b"".join(response.streaming_content) == PDF
    assert response["Content-Disposition"].startswith("attachment;")
    assert "My pass.pdf" in response["Content-Disposition"]


def test_another_customer_cannot_download_after_completion(other_customer_api, make_booking, add_pass):
    boarding_pass = add_pass(make_booking(status=Status.COMPLETED))
    assert other_customer_api.get(f"/api/boarding-passes/{boarding_pass.id}/download").status_code == 404


@pytest.mark.parametrize("status", [Status.PAID, Status.COMPLETED])
def test_admin_downloads_and_sees_passes_at_any_status(admin_api, make_booking, add_pass, status):
    booking = make_booking(status=status)
    boarding_pass = add_pass(booking, "pass.png", PNG)
    assert [p["id"] for p in admin_api.get(f"/api/admin/bookings/{booking.id}").data["boarding_passes"]] == [
        boarding_pass.id
    ]
    response = admin_api.get(f"/api/boarding-passes/{boarding_pass.id}/download")
    assert response.status_code == 200
    assert b"".join(response.streaming_content) == PNG


def test_download_unknown_pass_returns_404(admin_api):
    assert admin_api.get("/api/boarding-passes/999999/download").status_code == 404
