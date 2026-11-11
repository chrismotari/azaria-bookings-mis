"""The system owner's dashboard."""

from datetime import date
from decimal import Decimal

import pytest
from freezegun import freeze_time
from rest_framework.test import APIClient

from core.tests.helpers import OTHER_SCHEMA, TEST_SCHEMA
from tenants import billing
from tenants.models import Invoice, Plan, Subscription, Tenant
from tenants.tests.test_billing import plan, with_billing_email
from tenants.tests.test_platform import owner  # noqa: F401 (fixture)

pytestmark = pytest.mark.django_db


@pytest.fixture
def platform(owner):
    # Without a token: under a frozen clock a real token's issue time would lie in the future.
    client = APIClient(HTTP_HOST="localhost")
    client.force_authenticate(owner)
    return client


def invoice(tenant, amount, status=Invoice.Status.UNPAID, paid_on=None, due_on=date(2026, 1, 15), **extra):
    subscription = Subscription.objects.filter(tenant=tenant).first() or Subscription.objects.create(
        tenant=tenant,
        plan=plan(f"Plan for {tenant.schema_name}"),
        kind="subscription",
        billing_cycle="monthly",
        started_on=date(2025, 1, 1),
        next_period_start=date(2025, 2, 1),
        ended_on=date(2025, 1, 31),
    )
    number = f"INV-T-{Invoice.objects.count() + 1:04d}"
    return Invoice.objects.create(
        number=number,
        tenant=tenant,
        subscription=subscription,
        plan_name="Starter",
        billing_cycle="monthly",
        period_start=date(2026, 1, 1),
        period_end=date(2026, 1, 31),
        amount=Decimal(amount),
        issued_on=date(2026, 1, 1),
        due_on=due_on,
        status=status,
        paid_on=paid_on,
        **extra,
    )


def test_an_empty_platform(platform):
    with freeze_time("2026-03-10"):
        data = platform.get("/api/platform/dashboard").json()
    assert data["agencies"] == {"total": 2, "active": 2, "suspended": 0, "non_payment": 0, "no_plan": 2}
    assert data["revenue"] == {"this_month": "0.00", "this_year": "0.00", "all_time": "0.00"}
    assert data["recurring"] == {"monthly_value": "0.00", "subscriptions": 0, "support": 0}
    assert data["outstanding"] == {"count": 0, "total": "0.00", "overdue_count": 0, "overdue_total": "0.00"}
    assert [row["month"] for row in data["revenue_by_month"]][:2] == ["2025-04", "2025-05"]
    assert data["revenue_by_month"][-1] == {"month": "2026-03", "total": "0.00"}
    assert len(data["revenue_by_month"]) == 12
    assert data["plans"] == [] and data["attention"] == []
    assert data["currency"] == "USD"




def test_the_figures(platform):
    test_tenant = with_billing_email(TEST_SCHEMA, "a@test.test")
    other = with_billing_email(OTHER_SCHEMA, "a@other.test")
    Tenant.objects.filter(pk=other.pk).update(is_active=False, suspension_reason=Tenant.SuspensionReason.NON_PAYMENT)

    # Revenue by paid_on: across the year boundary, and void and unpaid left out.
    invoice(test_tenant, "100.00", Invoice.Status.PAID, paid_on=date(2025, 12, 31))
    invoice(test_tenant, "40.00", Invoice.Status.PAID, paid_on=date(2026, 1, 2))
    invoice(test_tenant, "60.00", Invoice.Status.PAID, paid_on=date(2026, 3, 1))
    invoice(test_tenant, "999.00", Invoice.Status.VOID)
    # Owed: one not yet due, two overdue (one waived: no suspension date).
    invoice(test_tenant, "10.00", due_on=date(2026, 3, 20))
    late = invoice(other, "20.00", due_on=date(2026, 1, 15))
    waived = invoice(other, "30.00", due_on=date(2026, 2, 1), suspension_waived=True)

    # Running plans: 120 a month, 1,200 a year (counted as 100), and a support plan of 30 a month.
    starter = plan("Starter", monthly="120.00", annual="1200.00")
    support = plan("Help", kind=Plan.Kind.SUPPORT, monthly="30.00", annual=None)
    for tenant, the_plan, cycle in [
        (test_tenant, starter, "monthly"),
        (other, starter, "annual"),
        (other, support, "monthly"),
    ]:
        Subscription.objects.create(
            tenant=tenant,
            plan=the_plan,
            kind=the_plan.kind,
            billing_cycle=cycle,
            started_on=date(2026, 1, 1),
            next_period_start=date(2026, 4, 1),
        )

    with freeze_time("2026-03-10"):
        data = platform.get("/api/platform/dashboard").json()
    assert data["agencies"] == {"total": 2, "active": 1, "suspended": 0, "non_payment": 1, "no_plan": 0}
    assert data["revenue"] == {"this_month": "60.00", "this_year": "100.00", "all_time": "200.00"}
    assert data["recurring"] == {"monthly_value": "250.00", "subscriptions": 2, "support": 1}
    assert data["outstanding"] == {"count": 3, "total": "60.00", "overdue_count": 2, "overdue_total": "50.00"}
    months = {row["month"]: row["total"] for row in data["revenue_by_month"]}
    assert months["2025-12"] == "100.00" and months["2026-01"] == "40.00" and months["2026-02"] == "0.00"
    assert months["2026-03"] == "60.00"
    assert data["plans"] == [
        {"id": str(starter.pk), "name": "Starter", "kind": "subscription", "agencies": 2},
        {"id": str(support.pk), "name": "Help", "kind": "support", "agencies": 1},
    ]
    assert [(row["number"], row["suspends_on"]) for row in data["attention"]] == [
        (late.number, str(billing.suspends_on(late))),
        (waived.number, None),
    ]
    assert data["attention"][0]["tenant"] == {"id": str(other.pk), "name": "Other Agency"}


def test_manual_suspensions_are_counted_apart(platform):
    Tenant.objects.filter(schema_name=OTHER_SCHEMA).update(is_active=False, suspension_reason="manual")
    data = platform.get("/api/platform/dashboard").json()
    assert data["agencies"]["suspended"] == 1 and data["agencies"]["non_payment"] == 0


def test_the_dashboard_is_for_platform_owners_only():
    assert APIClient(HTTP_HOST="localhost").get("/api/platform/dashboard").status_code == 401
    assert APIClient().get("/api/platform/dashboard").status_code == 404
