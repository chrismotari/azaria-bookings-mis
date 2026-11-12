"""The agency admin's dashboard: what needs action, sales, what is coming up, customers, offers and searches."""

from datetime import datetime, timedelta
from decimal import Decimal

from dateutil.relativedelta import relativedelta
from django.contrib.auth import get_user_model
from django.db.models import Count, DecimalField, ExpressionWrapper, F, OuterRef, Q, Subquery, Sum
from django.db.models.functions import Coalesce, TruncMonth
from django.utils import timezone

from catalog.models import Offer, Segment
from customer_requests.models import Query
from integrations.models import Fare, Integration
from integrations.services import search_usage
from tenants.billing_views import overdue_notice, this_tenant

from .models import Booking, BookingEvent, BookingSegment

ZERO = Decimal("0.00")
MONTHS_SHOWN = 12
LIST_SIZE = 5
PAYMENTS_DUE_WITHIN = timedelta(hours=48)
DEPARTURES_WITHIN_DAYS = 7
EXPIRING_WITHIN_DAYS = 7
SALE_STATUSES = [Booking.Status.PAID, Booking.Status.COMPLETED]


def money(amount):
    return f"{(amount or ZERO).quantize(Decimal('0.01')):.2f}"


def airport(code, city):
    return {"code": code, "city": city}


def route(booking):
    return {
        "origin": airport(booking.offer.origin.code, booking.offer.origin.city),
        "destination": airport(booking.offer.destination.code, booking.offer.destination.city),
        "trip_type": booking.trip_type,
    }


def customer(booking):
    return {"name": booking.user.full_name, "email": booking.user.email}


def sales():
    """Bookings that reached Paid, with their total and when they were marked paid."""
    paid_at = (
        BookingEvent.objects.filter(booking=OuterRef("pk"), to_status=Booking.Status.PAID)
        .order_by("-created_at")
        .values("created_at")[:1]
    )
    return Booking.objects.filter(status__in=SALE_STATUSES).annotate(
        paid_at=Coalesce(Subquery(paid_at), F("created_at")),
        amount=ExpressionWrapper(
            F("unit_price") * F("passenger_count"), output_field=DecimalField(max_digits=12, decimal_places=2)
        ),
    )


def summary():
    now = timezone.now()
    today = timezone.localdate()
    month_start = timezone.make_aware(datetime(today.year, today.month, 1))
    year_start = timezone.make_aware(datetime(today.year, 1, 1))
    first_month = month_start - relativedelta(months=MONTHS_SHOWN - 1)

    sold = sales()
    totals = sold.aggregate(
        this_month=Sum("amount", filter=Q(paid_at__gte=month_start)),
        this_year=Sum("amount", filter=Q(paid_at__gte=year_start)),
        all_time=Sum("amount"),
        count_this_month=Count("pk", filter=Q(paid_at__gte=month_start)),
    )
    by_month = {
        timezone.localtime(row["month"]).date(): row
        for row in sold.filter(paid_at__gte=first_month)
        .annotate(month=TruncMonth("paid_at"))
        .values("month")
        .annotate(total=Sum("amount"), count=Count("pk"))
    }
    months = [(first_month + relativedelta(months=index)).date() for index in range(MONTHS_SHOWN)]

    counts = {
        status: Booking.objects.filter(status=status).count()
        for status in [Booking.Status.REQUESTED, Booking.Status.AVAILABILITY_CONFIRMED, Booking.Status.PAID]
    }

    payments_due = (
        Booking.objects.filter(
            status=Booking.Status.AVAILABILITY_CONFIRMED,
            payment_deadline__gte=now,
            payment_deadline__lte=now + PAYMENTS_DUE_WITHIN,
        )
        .select_related("user", "offer__origin", "offer__destination")
        .order_by("payment_deadline")[:LIST_SIZE]
    )

    # A booking's own first outbound flight, or its offer's date.
    first_flight = BookingSegment.objects.filter(booking=OuterRef("pk"), direction=Segment.Direction.OUTBOUND).order_by(
        "position"
    )
    departures = (
        Booking.objects.filter(status__in=SALE_STATUSES)
        .annotate(departure=Coalesce(Subquery(first_flight.values("departure_date")[:1]), F("offer__departure_date")))
        .filter(departure__gte=today, departure__lte=today + timedelta(days=DEPARTURES_WITHIN_DAYS))
        .select_related("user", "offer__origin", "offer__destination")
        .order_by("departure", "created_at")[:LIST_SIZE]
    )

    top_routes = (
        sold.filter(paid_at__gte=year_start)
        .values(
            "offer__origin__code",
            "offer__origin__city",
            "offer__destination__code",
            "offer__destination__city",
            "trip_type",
        )
        .annotate(count=Count("pk"), total=Sum("amount"))
        .order_by("-count", "-total", "offer__origin__code", "offer__destination__code")[:LIST_SIZE]
    )

    searches = None
    if Integration.objects.exists():
        usage = search_usage()
        searches = {"used": usage["used"], "allowance": usage["allowance"]}

    customers = get_user_model().objects.filter(role="customer", is_active=True)
    bookable = Offer.objects.bookable()

    return {
        "open_queries": Query.objects.filter(status=Query.Status.OPEN).count(),
        "bookings_requested": counts[Booking.Status.REQUESTED],
        "bookings_awaiting_payment": counts[Booking.Status.AVAILABILITY_CONFIRMED],
        "bookings_paid_awaiting_boarding_pass": counts[Booking.Status.PAID],
        "new_fares": Fare.objects.filter(status=Fare.Status.NEW, picked=True).count(),
        "sales": {
            "this_month": money(totals["this_month"]),
            "this_year": money(totals["this_year"]),
            "all_time": money(totals["all_time"]),
            "count_this_month": totals["count_this_month"],
        },
        "sales_by_month": [
            {
                "month": f"{month:%Y-%m}",
                "total": money(by_month.get(month, {}).get("total")),
                "count": by_month.get(month, {}).get("count", 0),
            }
            for month in months
        ],
        "payments_due": [
            {
                "id": str(booking.pk),
                "customer": customer(booking),
                "route": route(booking),
                "total": money(booking.total_price),
                "payment_deadline": booking.payment_deadline,
            }
            for booking in payments_due
        ],
        "departures": [
            {
                "id": str(booking.pk),
                "customer": customer(booking),
                "route": route(booking),
                "departure_date": booking.departure,
                "passenger_count": booking.passenger_count,
                "boarding_passes_sent": booking.status == Booking.Status.COMPLETED,
            }
            for booking in departures
        ],
        "top_routes": [
            {
                "origin": airport(row["offer__origin__code"], row["offer__origin__city"]),
                "destination": airport(row["offer__destination__code"], row["offer__destination__city"]),
                "trip_type": row["trip_type"],
                "count": row["count"],
                "total": money(row["total"]),
            }
            for row in top_routes
        ],
        "customers": {
            "total": customers.count(),
            "new_this_month": customers.filter(date_joined__gte=month_start).count(),
        },
        "offers": {
            "bookable": bookable.count(),
            "public_bookable": bookable.filter(is_public=True).count(),
            "expiring_soon": bookable.filter(valid_until__lte=today + timedelta(days=EXPIRING_WITHIN_DAYS)).count(),
        },
        "searches": searches,
        "overdue_invoice": overdue_notice(this_tenant()),
    }
