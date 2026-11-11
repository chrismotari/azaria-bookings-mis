"""Plans, subscriptions, invoices and suspension for non-payment."""

from datetime import date
from decimal import Decimal

import pytest
from django.core import mail
from django.core.exceptions import ValidationError
from freezegun import freeze_time
from rest_framework.test import APIClient

from accounts.models import User
from core.tests.helpers import OTHER_DOMAIN, OTHER_SCHEMA, TEST_SCHEMA, html_part
from tenants import billing, tasks
from tenants.models import BillingCycle, Invoice, Plan, PlatformSettings, Subscription, Tenant
from tenants.tests.test_platform import owner, platform  # noqa: F401 (fixtures)

pytestmark = pytest.mark.django_db

MONTHLY, ANNUAL = BillingCycle.MONTHLY, BillingCycle.ANNUAL


@pytest.fixture(autouse=True)
def platform_settings():
    PlatformSettings.objects.update(
        issuer_details="Azaria Platform Ltd\nNairobi",
        payment_instructions="Bank transfer to account 123, quoting the invoice number.",
        invoice_due_days=14,
        invoice_lead_days=7,
        billing_contact_email="billing@azaria.test",
    )


@pytest.fixture
def agency():
    return with_billing_email(OTHER_SCHEMA, "accounts@other.test")


def with_billing_email(schema_name, email):
    Tenant.objects.filter(schema_name=schema_name).update(billing_email=email)
    return Tenant.objects.get(schema_name=schema_name)


def plan(name="Starter", kind=Plan.Kind.SUBSCRIPTION, monthly="100.00", annual="1000.00", **extra):
    return Plan.objects.create(
        name=name,
        kind=kind,
        monthly_price=None if monthly is None else Decimal(monthly),
        annual_price=None if annual is None else Decimal(annual),
        **extra,
    )


def start(tenant, the_plan=None, cycle=MONTHLY, on=date(2026, 1, 1), capture=None):
    return billing.start_subscription(tenant, the_plan or plan(), cycle, on)


def invoices(tenant):
    return list(Invoice.objects.filter(tenant=tenant).order_by("period_start"))


# Plans


def test_plans_need_a_price_and_keep_their_kind(platform):
    response = platform.post(
        "/api/platform/plans", {"name": "Basic", "kind": "subscription", "monthly_price": None}, format="json"
    )
    assert response.status_code == 400 and "monthly_price" in response.data
    response = platform.post(
        "/api/platform/plans", {"name": " Basic ", "kind": "subscription", "monthly_price": "49.00"}, format="json"
    )
    assert response.status_code == 201
    assert response.data["name"] == "Basic" and response.data["annual_price"] is None
    assert response.data["currency"] == "USD"
    url = f"/api/platform/plans/{response.data['id']}"
    assert platform.patch(url, {"kind": "support"}, format="json").status_code == 400
    assert platform.patch(url, {"is_active": False}, format="json").data["is_active"] is False
    assert platform.delete(url).status_code == 405


def test_the_plan_list_filters_by_kind_and_active(platform):
    plan("Basic")
    plan("Gold support", kind=Plan.Kind.SUPPORT)
    plan("Old", is_active=False)
    names = lambda **params: [p["name"] for p in platform.get("/api/platform/plans", params).data["results"]]  # noqa
    assert names(kind="support") == ["Gold support"]
    assert names(kind="subscription", is_active="true") == ["Basic"]


def test_a_price_in_use_cannot_be_removed(platform, agency):
    the_plan = plan()
    start(agency, the_plan, ANNUAL)
    url = f"/api/platform/plans/{the_plan.pk}"
    assert platform.patch(url, {"annual_price": None}, format="json").status_code == 400
    assert platform.patch(url, {"monthly_price": None}, format="json").status_code == 200


# Subscriptions


def test_a_subscription_needs_a_billing_email_and_an_offered_plan_and_price(agency):
    agency = with_billing_email(OTHER_SCHEMA, "")
    with pytest.raises(ValidationError, match="billing email"):
        start(agency)
    agency = with_billing_email(OTHER_SCHEMA, "accounts@other.test")
    with pytest.raises(ValidationError, match="no longer offered"):
        start(agency, plan("Old", is_active=False))
    with pytest.raises(ValidationError, match="no annual price"):
        start(agency, plan("Monthly only", annual=None), ANNUAL)
    assert not Subscription.objects.filter(tenant=agency).exists()


def test_one_running_subscription_per_kind(agency):
    start(agency)
    with pytest.raises(ValidationError, match="already has a subscription plan"):
        start(agency, plan("Premium"))
    # A support plan is separate.
    start(agency, plan("Support", kind=Plan.Kind.SUPPORT))
    assert Subscription.objects.filter(tenant=agency, ended_on__isnull=True).count() == 2


@freeze_time("2026-01-01")
def test_starting_issues_the_first_invoice_at_once(agency, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        subscription = start(agency, cycle=MONTHLY, on=date(2026, 1, 1))
    [invoice] = invoices(agency)
    assert (invoice.number, invoice.period_start, invoice.period_end) == (
        "INV-2026-0001",
        date(2026, 1, 1),
        date(2026, 1, 31),
    )
    assert invoice.amount == Decimal("100.00") and invoice.plan_name == "Starter"
    assert invoice.issued_on == date(2026, 1, 1) and invoice.due_on == date(2026, 1, 15)
    assert invoice.status == Invoice.Status.UNPAID
    assert invoice.pdf.name.startswith(f"invoices/{OTHER_SCHEMA}/") and invoice.pdf.name.endswith(".pdf")
    subscription.refresh_from_db()
    assert subscription.next_period_start == date(2026, 2, 1)

    # Links point at the agency's own domain.
    [email] = mail.outbox
    assert email.to == ["accounts@other.test"]
    assert email.subject == "Invoice INV-2026-0001 from Azaria Bookings"
    [(name, content, mimetype)] = email.attachments
    assert name == "INV-2026-0001.pdf" and mimetype == "application/pdf" and content.startswith(b"%PDF")
    assert "USD 100.00" in email.body and "Bank transfer" in email.body
    assert f"http://{OTHER_DOMAIN}:8081/admin/billing" in email.body
    assert "INV-2026-0001" in html_part(email)


def test_plan_changes_apply_to_later_invoices_only(agency):
    subscription = start(agency, cycle=MONTHLY)
    premium = plan("Premium", monthly="250.00")
    billing.change_subscription(subscription, plan=premium)
    with pytest.raises(ValidationError, match="Choose a subscription plan"):
        billing.change_subscription(subscription, plan=plan("Help", kind=Plan.Kind.SUPPORT))
    billing.issue_invoice(subscription)
    first, second = invoices(agency)
    assert (first.plan_name, first.amount) == ("Starter", Decimal("100.00"))
    assert (second.plan_name, second.amount) == ("Premium", Decimal("250.00"))
    # Editing a plan never changes an issued invoice.
    Plan.objects.filter(pk=premium.pk).update(name="Renamed", monthly_price=Decimal("1.00"))
    second.refresh_from_db()
    assert (second.plan_name, second.amount) == ("Premium", Decimal("250.00"))


@freeze_time("2026-03-10")
def test_ending_stops_invoicing(agency):
    subscription = start(agency)
    billing.end_subscription(subscription)
    assert subscription.ended_on == date(2026, 3, 10)
    with pytest.raises(ValidationError):
        billing.issue_invoice(subscription)
    assert billing.issue_due_invoices() == 0
    # A new plan of that kind can start now.
    start(agency, plan("Premium"))


# Periods


@pytest.mark.parametrize(
    "started_on, cycle, periods",
    [
        (
            date(2026, 1, 31),
            MONTHLY,
            [
                (date(2026, 1, 31), date(2026, 2, 27)),
                (date(2026, 2, 28), date(2026, 3, 30)),
                (date(2026, 3, 31), date(2026, 4, 29)),
            ],
        ),
        (date(2028, 2, 29), ANNUAL, [(date(2028, 2, 29), date(2029, 2, 27)), (date(2029, 2, 28), date(2030, 2, 27))]),
        (
            date(2026, 12, 15),
            MONTHLY,
            [(date(2026, 12, 15), date(2027, 1, 14)), (date(2027, 1, 15), date(2027, 2, 14))],
        ),
    ],
)
def test_periods_keep_the_starting_day(agency, started_on, cycle, periods):
    subscription = start(agency, cycle=cycle, on=started_on)
    for _ in periods[1:]:
        billing.issue_invoice(subscription)
    assert [(i.period_start, i.period_end) for i in invoices(agency)] == periods


def test_numbers_run_per_year(agency):
    with freeze_time("2026-12-30"):
        subscription = start(agency, on=date(2026, 12, 30))
        billing.issue_invoice(subscription)
    with freeze_time("2027-01-02"):
        billing.issue_invoice(subscription)
    assert [i.number for i in invoices(agency)] == ["INV-2026-0001", "INV-2026-0002", "INV-2027-0001"]


def test_the_daily_job_issues_within_the_lead_days_and_catches_up(agency):
    with freeze_time("2026-01-01"):
        subscription = start(agency, on=date(2026, 1, 1))
    with freeze_time("2026-01-24"):
        # The next period starts on 1 Feb: 8 days ahead, outside the 7 lead days.
        assert tasks.issue_due_invoices.delay().get() == 0
    with freeze_time("2026-01-25"):
        assert tasks.issue_due_invoices.delay().get() == 1
        assert tasks.issue_due_invoices.delay().get() == 0
    with freeze_time("2026-03-28"):
        # Missed days (periods of 1 Mar and 1 Apr): one invoice per run until it has caught up.
        assert tasks.issue_due_invoices.delay().get() == 1
        assert tasks.issue_due_invoices.delay().get() == 1
        assert tasks.issue_due_invoices.delay().get() == 0
    subscription.refresh_from_db()
    assert subscription.next_period_start == date(2026, 5, 1)


def test_the_invoice_email_is_skipped_once_paid_or_void(agency):
    invoice = invoices_for_new(agency)
    mail.outbox.clear()
    billing.mark_paid(invoice)
    tasks.send_invoice.delay(str(invoice.pk))
    assert mail.outbox == []


def invoices_for_new(tenant, on=date(2026, 1, 1), cycle=MONTHLY):
    with freeze_time(on):
        start(tenant, cycle=cycle, on=on)
    return invoices(tenant)[-1]


# Paying


@freeze_time("2026-01-20")
def test_mark_paid_unpaid_and_void(agency):
    invoice = invoices_for_new(agency)
    old_pdf = invoice.pdf.name
    billing.mark_paid(invoice, date(2026, 1, 18))
    invoice.refresh_from_db()
    assert (invoice.status, invoice.paid_on) == (Invoice.Status.PAID, date(2026, 1, 18))
    assert invoice.pdf.name != old_pdf
    with pytest.raises(ValidationError):
        billing.mark_paid(invoice)
    with pytest.raises(ValidationError):
        billing.void(invoice)
    billing.mark_unpaid(invoice)
    invoice.refresh_from_db()
    assert (invoice.status, invoice.paid_on) == (Invoice.Status.UNPAID, None)
    billing.void(invoice)
    invoice.refresh_from_db()
    assert invoice.status == Invoice.Status.VOID


# Suspension for non-payment


def suspend_run(on):
    with freeze_time(on):
        return tasks.suspend_overdue_tenants.delay().get()


def test_suspension_only_a_month_past_the_due_date(agency, django_capture_on_commit_callbacks):
    invoice = invoices_for_new(agency)  # due 15 Jan 2026
    assert billing.suspends_on(invoice) == date(2026, 2, 16)
    assert suspend_run("2026-02-15") == 0
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        assert suspend_run("2026-02-16") == 1
    agency.refresh_from_db()
    assert (agency.is_active, agency.suspension_reason) == (False, Tenant.SuspensionReason.NON_PAYMENT)
    assert agency.suspended_at is not None

    [email] = mail.outbox
    assert email.to == ["accounts@other.test"]
    assert "suspended for non-payment" in email.subject
    assert invoice.number in email.body and "USD 100.00" in email.body and "billing@azaria.test" in email.body
    html_part(email)

    # The agency's API says why.
    response = APIClient(HTTP_HOST=OTHER_DOMAIN).get("/api/offers")
    assert response.status_code == 403
    assert response.json() == {
        "detail": "This agency's account is suspended for non-payment. Contact billing@azaria.test.",
        "code": "tenant_suspended",
    }


@pytest.mark.parametrize("settle", ["paid", "void", "waived"])
def test_settled_invoices_do_not_suspend(agency, settle):
    invoice = invoices_for_new(agency)
    if settle == "paid":
        billing.mark_paid(invoice)
    elif settle == "void":
        billing.void(invoice)
    else:
        Invoice.objects.filter(pk=invoice.pk).update(suspension_waived=True)
    assert suspend_run("2026-06-01") == 0
    agency.refresh_from_db()
    assert agency.is_active


def test_suspended_agencies_are_not_checked_again(agency):
    invoices_for_new(agency)
    billing.set_active(agency, False)
    assert suspend_run("2026-06-01") == 0
    agency.refresh_from_db()
    assert agency.suspension_reason == Tenant.SuspensionReason.MANUAL


def test_an_error_for_one_agency_does_not_stop_the_others(agency, monkeypatch):
    test_tenant = with_billing_email(TEST_SCHEMA, "accounts@test.test")
    invoices_for_new(agency)
    invoices_for_new(test_tenant)
    original = billing.set_active

    def fail_for_other(tenant, *args, **kwargs):
        if tenant.schema_name == OTHER_SCHEMA:
            raise RuntimeError("boom")
        return original(tenant, *args, **kwargs)

    monkeypatch.setattr(billing, "set_active", fail_for_other)
    assert suspend_run("2026-06-01") == 1
    test_tenant.refresh_from_db()
    agency.refresh_from_db()
    assert not test_tenant.is_active and agency.is_active


def test_marking_paid_lifts_only_a_non_payment_suspension_with_nothing_else_overdue(agency):
    first = invoices_for_new(agency, on=date(2026, 1, 1))
    second = invoices_for_new_period(agency, on=date(2026, 1, 25))
    suspend_run("2026-03-15")
    agency.refresh_from_db()
    assert not agency.is_active
    with freeze_time("2026-03-15"):
        billing.mark_paid(first)
        agency.refresh_from_db()
        assert not agency.is_active  # the second one is still past the limit
        billing.mark_paid(second)
    agency.refresh_from_db()
    assert (agency.is_active, agency.suspension_reason, agency.suspended_at) == (True, "", None)

    # A manual suspension is never lifted by a payment.
    third = invoices_for_new_period(agency, on=date(2026, 2, 25))
    billing.set_active(agency, False)
    billing.mark_paid(third)
    agency.refresh_from_db()
    assert not agency.is_active


def invoices_for_new_period(tenant, on):
    """The next invoice of the agency's running subscription, issued on that day."""
    with freeze_time(on):
        billing.issue_invoice(Subscription.objects.get(tenant=tenant, ended_on__isnull=True))
    return invoices(tenant)[-1]


def test_owner_reactivation_waives_and_a_later_invoice_suspends_again(agency):
    first = invoices_for_new(agency, on=date(2026, 1, 1))
    suspend_run("2026-02-16")
    with freeze_time("2026-02-17"):
        billing.set_active(agency, True)
    first.refresh_from_db()
    agency.refresh_from_db()
    assert first.suspension_waived and first.status == Invoice.Status.UNPAID
    assert agency.is_active and agency.suspension_reason == ""
    assert suspend_run("2026-02-18") == 0

    # The next period's invoice (issued 25 Jan, due 8 Feb) is past its own limit on 9 Mar.
    invoices_for_new_period(agency, on=date(2026, 1, 25))
    assert suspend_run("2026-03-10") == 1


# Platform API


def test_platform_billing_api_flow(platform, agency):
    tenant_url = f"/api/platform/tenants/{agency.pk}"
    assert platform.patch(tenant_url, {"billing_email": "bad"}, format="json").status_code == 400
    response = platform.patch(tenant_url, {"billing_email": "pay@other.test"}, format="json")
    assert response.data["billing_email"] == "pay@other.test"

    the_plan = plan()
    response = platform.post(
        f"{tenant_url}/subscriptions",
        {"plan": str(the_plan.pk), "billing_cycle": "annual", "started_on": "2026-01-01"},
        format="json",
    )
    assert response.status_code == 201, response.data
    subscription = response.data
    assert subscription["plan"]["name"] == "Starter" and subscription["price"] == "1000.00"
    assert subscription["next_period_start"] == "2027-01-01"
    again = platform.post(
        f"{tenant_url}/subscriptions", {"plan": str(the_plan.pk), "billing_cycle": "monthly"}, format="json"
    )
    assert again.status_code == 400 and "plan" in again.data
    assert len(platform.get(f"{tenant_url}/subscriptions").data) == 1

    response = platform.patch(
        f"/api/platform/subscriptions/{subscription['id']}", {"billing_cycle": "monthly"}, format="json"
    )
    assert response.data["billing_cycle"] == "monthly" and response.data["price"] == "100.00"
    issued = platform.post(f"/api/platform/subscriptions/{subscription['id']}/issue-invoice")
    assert issued.status_code == 201 and issued.data["amount"] == "100.00"

    listed = platform.get("/api/platform/invoices", {"tenant": agency.pk}).data["results"]
    assert len(listed) == 2 and listed[0]["tenant"] == {"id": str(agency.pk), "name": "Other Agency"}
    invoice_url = f"/api/platform/invoices/{listed[0]['id']}"
    assert platform.get(invoice_url).data["number"] == listed[0]["number"]
    pdf = platform.get(f"{invoice_url}/pdf")
    assert pdf.status_code == 200 and b"".join(pdf.streaming_content).startswith(b"%PDF")

    assert platform.post(f"{invoice_url}/resend").status_code == 200
    future = platform.post(f"{invoice_url}/mark-paid", {"paid_on": "2999-01-01"}, format="json")
    assert future.status_code == 400
    paid = platform.post(f"{invoice_url}/mark-paid", {"paid_on": "2026-01-05"}, format="json")
    assert paid.data["status"] == "paid" and paid.data["paid_on"] == "2026-01-05"
    assert platform.post(f"{invoice_url}/mark-paid").status_code == 409
    assert platform.post(f"{invoice_url}/resend").status_code == 409
    assert platform.post(f"{invoice_url}/mark-unpaid").data["status"] == "unpaid"
    assert platform.post(f"{invoice_url}/void").data["status"] == "void"
    assert platform.get("/api/platform/invoices", {"status": "void"}).data["count"] == 1

    ended = platform.post(f"/api/platform/subscriptions/{subscription['id']}/end")
    assert ended.data["ended_on"] is not None
    assert platform.post(f"/api/platform/subscriptions/{subscription['id']}/end").status_code == 409


def test_the_overdue_filter_and_suspends_on(owner, agency):
    # Signed in without a token: under a frozen clock a real token's issue time would lie in the future.
    platform = APIClient(HTTP_HOST="localhost")
    platform.force_authenticate(owner)
    invoices_for_new(agency)
    with freeze_time("2026-01-16"):
        [row] = platform.get("/api/platform/invoices", {"overdue": "true"}).json()["results"]
        assert row["overdue"] is True and row["suspends_on"] == "2026-02-16"
    with freeze_time("2026-01-14"):
        assert platform.get("/api/platform/invoices", {"overdue": "true"}).data["count"] == 0


def test_platform_reactivation_and_manual_suspension_through_the_api(platform, agency):
    invoices_for_new(agency)
    suspend_run("2026-02-16")
    url = f"/api/platform/tenants/{agency.pk}"
    assert platform.get(url).data["suspension_reason"] == "non_payment"
    response = platform.patch(url, {"is_active": True}, format="json")
    assert response.data["is_active"] is True and response.data["suspension_reason"] == ""
    assert Invoice.objects.get(tenant=agency).suspension_waived
    response = platform.patch(url, {"is_active": False}, format="json")
    assert response.data["suspension_reason"] == "manual" and response.data["suspended_at"]
    response = APIClient(HTTP_HOST=OTHER_DOMAIN).get("/api/offers")
    assert response.json()["detail"] == "This agency is not available at the moment."


def test_platform_settings(platform):
    response = platform.get("/api/platform/settings")
    assert response.data["invoice_due_days"] == 14 and response.data["currency"] == "USD"
    response = platform.patch("/api/platform/settings", {"invoice_due_days": 30, "currency": "EUR"}, format="json")
    assert response.data["invoice_due_days"] == 30 and response.data["currency"] == "USD"


def test_billing_endpoints_are_for_platform_owners_only(agency):
    the_plan = plan()
    invoice = invoices_for_new(agency)
    for client in [APIClient(HTTP_HOST="localhost"), APIClient()]:
        for url in [
            "/api/platform/plans",
            f"/api/platform/plans/{the_plan.pk}",
            "/api/platform/invoices",
            f"/api/platform/invoices/{invoice.pk}/pdf",
            "/api/platform/settings",
        ]:
            assert client.get(url).status_code in (401, 404), url
        assert client.post(f"/api/platform/invoices/{invoice.pk}/mark-paid").status_code in (401, 404)
    invoice.refresh_from_db()
    assert invoice.status == Invoice.Status.UNPAID


# The agency's billing


def agency_admin_client(host=None):
    user = User.objects.create_user(
        email="boss@test.test", password="Str0ng-pass!", full_name="Boss", role=User.Role.ADMIN
    )
    client = APIClient(**({"HTTP_HOST": host} if host else {}))
    client.force_authenticate(user)
    return client


def test_agency_admins_see_their_billing_only(customer_api):
    test_tenant = with_billing_email(TEST_SCHEMA, "accounts@test.test")
    other = with_billing_email(OTHER_SCHEMA, "accounts@other.test")
    mine = invoices_for_new(test_tenant)
    theirs = invoices_for_new(other)
    client = agency_admin_client()

    with freeze_time("2026-01-20"):
        data = client.get("/api/admin/billing").json()
    assert data["billing_contact_email"] == "billing@azaria.test"
    assert data["subscriptions"] == [
        {
            "plan_name": "Starter",
            "kind": "subscription",
            "billing_cycle": "monthly",
            "price": "100.00",
            "currency": "USD",
            "next_period_start": "2026-02-01",
        }
    ]
    assert data["overdue"] == {
        "number": mine.number,
        "amount": "100.00",
        "currency": "USD",
        "due_on": "2026-01-15",
        "suspends_on": "2026-02-16",
    }
    with freeze_time("2026-01-10"):
        assert client.get("/api/admin/billing").json()["overdue"] is None

    rows = client.get("/api/admin/billing/invoices").data["results"]
    assert [row["number"] for row in rows] == [mine.number]
    assert "suspension_waived" not in rows[0] and "tenant" not in rows[0]
    assert client.get(f"/api/admin/billing/invoices/{mine.pk}/pdf").status_code == 200
    assert client.get(f"/api/admin/billing/invoices/{theirs.pk}/pdf").status_code == 404

    for url in ["/api/admin/billing", "/api/admin/billing/invoices", f"/api/admin/billing/invoices/{mine.pk}/pdf"]:
        assert customer_api.get(url).status_code == 403
        assert APIClient().get(url).status_code == 401
