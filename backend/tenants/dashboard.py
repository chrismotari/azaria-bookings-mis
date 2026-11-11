"""The system owner's dashboard: agencies, revenue, recurring value, what is owed and what needs attention."""

from decimal import Decimal

from dateutil.relativedelta import relativedelta
from django.conf import settings
from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncMonth
from django_tenants.utils import get_public_schema_name

from . import billing
from .models import BillingCycle, Invoice, Subscription, Tenant

ZERO = Decimal("0.00")
MONTHS_SHOWN = 12


def money(amount):
    return f"{(amount or ZERO).quantize(Decimal('0.01')):.2f}"


def monthly_value(subscription):
    """A monthly price as is, an annual one as a twelfth."""
    price = subscription.plan.price_for(subscription.billing_cycle) or ZERO
    return price if subscription.billing_cycle == BillingCycle.MONTHLY else price / 12


def summary():
    today = billing.today()
    month_start = today.replace(day=1)
    year_start = today.replace(month=1, day=1)

    agencies = Tenant.objects.exclude(schema_name=get_public_schema_name())
    running = Subscription.objects.filter(ended_on__isnull=True).select_related("plan")
    with_plan = running.filter(kind="subscription").values("tenant_id")
    counts = agencies.aggregate(
        total=Count("pk"),
        active=Count("pk", filter=Q(is_active=True)),
        non_payment=Count("pk", filter=Q(is_active=False, suspension_reason=Tenant.SuspensionReason.NON_PAYMENT)),
        no_plan=Count("pk", filter=~Q(pk__in=with_plan)),
    )
    counts["suspended"] = counts["total"] - counts["active"] - counts["non_payment"]

    paid = Invoice.objects.filter(status=Invoice.Status.PAID)
    revenue = paid.aggregate(
        this_month=Sum("amount", filter=Q(paid_on__gte=month_start)),
        this_year=Sum("amount", filter=Q(paid_on__gte=year_start)),
        all_time=Sum("amount"),
    )

    unpaid = Invoice.objects.filter(status=Invoice.Status.UNPAID)
    overdue = unpaid.filter(due_on__lt=today)
    owed = unpaid.aggregate(count=Count("pk"), total=Sum("amount"))
    late = overdue.aggregate(count=Count("pk"), total=Sum("amount"))

    first_month = month_start - relativedelta(months=MONTHS_SHOWN - 1)
    by_month = {
        row["month"]: row["total"]
        for row in paid.filter(paid_on__gte=first_month)
        .annotate(month=TruncMonth("paid_on"))
        .values("month")
        .annotate(total=Sum("amount"))
    }
    months = [first_month + relativedelta(months=index) for index in range(MONTHS_SHOWN)]

    subscriptions = list(running)
    plans = (
        running.values("plan_id", "plan__name", "plan__kind")
        .annotate(agencies=Count("tenant_id", distinct=True))
        .order_by("-agencies", "plan__name")
    )

    attention = overdue.select_related("tenant").order_by("due_on", "number")[:5]
    return {
        "currency": settings.PLATFORM_CURRENCY,
        "agencies": counts,
        "revenue": {key: money(value) for key, value in revenue.items()},
        "recurring": {
            "monthly_value": money(sum((monthly_value(item) for item in subscriptions), ZERO)),
            "subscriptions": sum(1 for item in subscriptions if item.kind == "subscription"),
            "support": sum(1 for item in subscriptions if item.kind == "support"),
        },
        "outstanding": {
            "count": owed["count"],
            "total": money(owed["total"]),
            "overdue_count": late["count"],
            "overdue_total": money(late["total"]),
        },
        "revenue_by_month": [{"month": f"{month:%Y-%m}", "total": money(by_month.get(month))} for month in months],
        "plans": [
            {"id": str(row["plan_id"]), "name": row["plan__name"], "kind": row["plan__kind"], "agencies": row["agencies"]}
            for row in plans
        ],
        "attention": [
            {
                "id": str(invoice.pk),
                "number": invoice.number,
                "tenant": {"id": str(invoice.tenant_id), "name": invoice.tenant.name},
                "amount": money(invoice.amount),
                "due_on": invoice.due_on,
                "suspends_on": None if invoice.suspension_waived else billing.suspends_on(invoice),
            }
            for invoice in attention
        ],
    }
