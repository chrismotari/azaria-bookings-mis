import threading
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.core import mail
from django.db import connection
from django.utils import timezone
from freezegun import freeze_time

from bookings import tasks
from bookings.models import Booking, BookingEvent
from bookings.services import InvalidTransition, transition
from core.models import AppSettings

Status = Booking.Status

NAIROBI = ZoneInfo("Africa/Nairobi")
DEADLINE = datetime(2026, 3, 2, 18, 0, tzinfo=NAIROBI)


@pytest.fixture
def instructions(db):
    AppSettings.objects.filter(pk=1).update(
        payment_instructions="M-Pesa paybill 123456, account AZARIA.", reminder_hours_before=4
    )


@pytest.fixture
def make_booking(customer, make_offer):
    def make(status=Status.AVAILABILITY_CONFIRMED, payment_deadline=DEADLINE, **offer_fields):
        offer = make_offer(**offer_fields)
        return Booking.objects.create(
            user=customer,
            offer=offer,
            passenger_count=1,
            unit_price=offer.price,
            status=status,
            payment_deadline=payment_deadline if status == Status.AVAILABILITY_CONFIRMED else None,
        )

    return make


def statuses(*bookings):
    return [Booking.objects.get(pk=booking.pk).status for booking in bookings]


# expire_unpaid_bookings


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("now", "expected"),
    [
        (DEADLINE - timedelta(minutes=1), Status.AVAILABILITY_CONFIRMED),
        (DEADLINE, Status.AVAILABILITY_CONFIRMED),
        (DEADLINE + timedelta(seconds=1), Status.EXPIRED),
    ],
)
def test_expire_unpaid_bookings_around_the_deadline(make_booking, django_capture_on_commit_callbacks, now, expected):
    booking = make_booking()
    with freeze_time(now), django_capture_on_commit_callbacks(execute=True):
        tasks.expire_unpaid_bookings()
    assert statuses(booking) == [expected]
    if expected == Status.EXPIRED:
        event = BookingEvent.objects.get(booking=booking)
        assert (event.from_status, event.to_status, event.actor) == (Status.AVAILABILITY_CONFIRMED, Status.EXPIRED, None)
        [email] = mail.outbox
        assert email.subject == "Your booking has expired"
    else:
        assert mail.outbox == []


@pytest.mark.django_db
def test_expire_unpaid_bookings_leaves_other_statuses_alone(make_booking):
    requested = make_booking(status=Status.REQUESTED)
    paid = make_booking(status=Status.PAID)
    with freeze_time(DEADLINE + timedelta(days=1)):
        assert tasks.expire_unpaid_bookings() == 0
    assert statuses(requested, paid) == [Status.REQUESTED, Status.PAID]


@pytest.mark.django_db
def test_expire_skips_bookings_that_changed_meanwhile(make_booking, admin_user, instructions, monkeypatch):
    booking = make_booking()
    other = make_booking()

    # Pay the first booking between the task's query and its transition.
    real_expire = tasks._expire

    def pay_first_then_expire(booking_ids):
        Booking.objects.filter(pk=booking.pk).update(status=Status.PAID)
        return real_expire(booking_ids)

    monkeypatch.setattr(tasks, "_expire", pay_first_then_expire)
    with freeze_time(DEADLINE + timedelta(minutes=1)):
        assert tasks.expire_unpaid_bookings() == 1
    assert statuses(booking, other) == [Status.PAID, Status.EXPIRED]


# send_payment_reminders

REMINDER_FROM = DEADLINE - timedelta(hours=4)


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("now", "sent"),
    [
        (REMINDER_FROM - timedelta(seconds=1), False),
        (REMINDER_FROM, True),
        (DEADLINE - timedelta(seconds=1), True),
        (DEADLINE, False),
        (DEADLINE + timedelta(minutes=1), False),
    ],
)
def test_reminder_window(make_booking, instructions, django_capture_on_commit_callbacks, now, sent):
    booking = make_booking()
    with freeze_time(now), django_capture_on_commit_callbacks(execute=True):
        assert tasks.send_payment_reminders() == int(sent)
    booking.refresh_from_db()
    if sent:
        assert booking.reminder_sent_at == now
        [email] = mail.outbox
        assert email.to == ["customer@example.com"]
        assert email.subject == "Reminder: your payment is due soon"
        assert "Mon, 2 Mar 2026 at 18:00 (Nairobi time)" in email.body
        assert "M-Pesa paybill 123456, account AZARIA." in email.body
    else:
        assert booking.reminder_sent_at is None
        assert mail.outbox == []


@pytest.mark.django_db
def test_reminder_is_sent_only_once(make_booking, instructions, django_capture_on_commit_callbacks):
    make_booking()
    for minutes in (0, 15, 30):
        with freeze_time(REMINDER_FROM + timedelta(minutes=minutes)), django_capture_on_commit_callbacks(execute=True):
            tasks.send_payment_reminders()
    assert len(mail.outbox) == 1


@pytest.mark.django_db
def test_reminder_uses_reminder_hours_from_settings(make_booking, instructions):
    AppSettings.objects.filter(pk=1).update(reminder_hours_before=1)
    make_booking()
    with freeze_time(DEADLINE - timedelta(hours=2)):
        assert tasks.send_payment_reminders() == 0
    with freeze_time(DEADLINE - timedelta(minutes=59)):
        assert tasks.send_payment_reminders() == 1


@pytest.mark.django_db
def test_reminders_skip_other_statuses(make_booking, instructions):
    make_booking(status=Status.PAID)
    make_booking(status=Status.REQUESTED)
    with freeze_time(REMINDER_FROM):
        assert tasks.send_payment_reminders() == 0


@pytest.mark.django_db
@pytest.mark.parametrize("change", ["paid", "deadline_passed"])
def test_reminder_email_skipped_when_state_has_changed(make_booking, instructions, change):
    booking = make_booking()
    if change == "paid":
        Booking.objects.filter(pk=booking.pk).update(status=Status.PAID)
    with freeze_time(DEADLINE if change == "deadline_passed" else REMINDER_FROM):
        tasks.notify_customer_payment_reminder(booking.id)
    tasks.notify_customer_payment_reminder(999999)
    assert mail.outbox == []


# expire_stale_requests


@pytest.mark.django_db
def test_expire_stale_requests(make_booking, django_capture_on_commit_callbacks):
    today = timezone.localdate()
    departed = make_booking(
        status=Status.REQUESTED, departure_date=today - timedelta(days=1), valid_until=today - timedelta(days=2)
    )
    departs_today = make_booking(status=Status.REQUESTED, departure_date=today, valid_until=today)
    confirmed = make_booking(
        status=Status.AVAILABILITY_CONFIRMED,
        payment_deadline=timezone.now() + timedelta(hours=1),
        departure_date=today - timedelta(days=1),
        valid_until=today - timedelta(days=2),
    )
    with django_capture_on_commit_callbacks(execute=True):
        assert tasks.expire_stale_requests() == 1
    assert statuses(departed, departs_today, confirmed) == [Status.EXPIRED, Status.REQUESTED, Status.AVAILABILITY_CONFIRMED]
    assert BookingEvent.objects.get(booking=departed).actor is None
    assert [email.subject for email in mail.outbox] == ["Your booking has expired"]


@pytest.mark.django_db
def test_expire_stale_requests_after_midnight_in_nairobi(make_booking):
    departure = datetime(2026, 3, 2).date()
    booking = make_booking(status=Status.REQUESTED, departure_date=departure, valid_until=departure)
    # 23:59 on the departure day in Nairobi: not yet stale.
    with freeze_time(datetime(2026, 3, 2, 23, 59, tzinfo=NAIROBI)):
        assert tasks.expire_stale_requests() == 0
    with freeze_time(datetime(2026, 3, 3, 0, 1, tzinfo=NAIROBI)):
        assert tasks.expire_stale_requests() == 1
    assert statuses(booking) == [Status.EXPIRED]


# Marking paid while the expiry task runs


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_mark_paid_racing_expiry_ends_in_exactly_one_outcome(make_booking, admin_user, instructions):
    booking = make_booking(payment_deadline=timezone.now() + timedelta(hours=1))
    barrier = threading.Barrier(2)
    outcomes = {}

    def attempt(name, to_status, actor):
        barrier.wait()
        try:
            transition(booking.id, to_status, actor)
            outcomes[name] = "done"
        except InvalidTransition:
            outcomes[name] = "refused"
        finally:
            connection.close()

    threads = [
        threading.Thread(target=attempt, args=("pay", Status.PAID, admin_user)),
        threading.Thread(target=attempt, args=("expire", Status.EXPIRED, None)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(outcomes.values()) == ["done", "refused"]
    booking.refresh_from_db()
    winner = "pay" if outcomes["pay"] == "done" else "expire"
    assert booking.status == (Status.PAID if winner == "pay" else Status.EXPIRED)
    assert list(BookingEvent.objects.filter(booking=booking).values_list("to_status", flat=True)) == [booking.status]


# Admin settings


@pytest.mark.django_db
def test_settings_endpoint_rejects_customers_and_guests(api, customer_api):
    for client, code in [(api, 401), (customer_api, 403)]:
        assert client.get("/api/admin/settings").status_code == code
        assert client.patch("/api/admin/settings", {"payment_hold_hours": 1}, format="json").status_code == code


@pytest.mark.django_db
def test_admin_reads_and_updates_settings(admin_api, settings):
    response = admin_api.get("/api/admin/settings")
    assert response.status_code == 200
    assert response.data == {
        "payment_instructions": "",
        "payment_hold_hours": 24,
        "reminder_hours_before": 4,
        "admin_notification_email": settings.ADMIN_EMAIL,
    }
    payload = {
        "payment_instructions": "Bank transfer to Azaria Ltd.",
        "payment_hold_hours": 48,
        "reminder_hours_before": 6,
        "admin_notification_email": "bookings@azariabookings.com",
    }
    response = admin_api.patch("/api/admin/settings", payload, format="json")
    assert response.status_code == 200
    assert response.data == payload
    app_settings = AppSettings.get()
    assert (app_settings.payment_hold_hours, app_settings.admin_notification_email) == (48, "bookings@azariabookings.com")
    assert AppSettings.objects.count() == 1


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("field", "value"),
    [("payment_hold_hours", 0), ("reminder_hours_before", 0), ("admin_notification_email", "not-an-email")],
)
def test_settings_validation(admin_api, field, value):
    response = admin_api.patch("/api/admin/settings", {field: value}, format="json")
    assert response.status_code == 400
    assert field in response.data


@pytest.mark.django_db
def test_settings_put_not_allowed(admin_api):
    assert admin_api.put("/api/admin/settings", {}, format="json").status_code == 405
