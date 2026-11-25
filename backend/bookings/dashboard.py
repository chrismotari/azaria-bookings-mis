"""The agency admin's dashboard across the modules it has on: what needs action, what was sold, what is coming up
and what is on sale."""

from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal

from dateutil.relativedelta import relativedelta
from django.contrib.auth import get_user_model
from django.db.models import Count, DecimalField, ExpressionWrapper, F, OuterRef, Subquery, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from catalog.models import Offer, Segment
from customer_requests.models import Query
from hotels import pricing
from hotels.models import HotelBooking, HotelBookingEvent
from integrations.models import Fare, Integration
from integrations.services import search_usage
from tenants.billing_views import overdue_notice, this_tenant
from tenants.models import MODULES
from tours.models import Tour, TourBooking, TourBookingLine

from .models import Booking, BookingEvent, BookingSegment

ZERO = Decimal("0.00")
MONTHS_SHOWN = 12
LIST_SIZE = 5
THIS_WEEK_SIZE = 8
PAYMENTS_DUE_WITHIN = timedelta(hours=48)
WEEK_DAYS = 7
EXPIRING_WITHIN_DAYS = 7
PRICES_AHEAD_DAYS = 30
KINDS = {"flights": "flight", "tours": "tour", "hotels": "hotel"}
KIND_ORDER = {"flight": 0, "tour": 1, "hotel": 2}
FLIGHT_SALE = [Booking.Status.PAID, Booking.Status.COMPLETED]
HOTEL_SALE = [HotelBooking.Status.PAID, HotelBooking.Status.COMPLETED]
TOUR_SALE = [TourBooking.Status.CONFIRMED, TourBooking.Status.COMPLETED]


def money(amount):
    return f"{(amount or ZERO).quantize(Decimal('0.01')):.2f}"


def route_line(offer, trip_type):
    arrow = "⇄" if trip_type == "return" else "→"
    return f"{offer.origin.code} {arrow} {offer.destination.code}"


def customer(booking):
    return {"name": booking.user.full_name, "email": booking.user.email}


def paid_at(event_model):
    """When the booking was marked paid (its latest Paid event), else when it was made."""
    paid = (
        event_model.objects.filter(booking=OuterRef("pk"), to_status="paid")
        .order_by("-created_at")
        .values("created_at")[:1]
    )
    return Coalesce(Subquery(paid), F("created_at"))


def flight_sales():
    """(sold on, amount, (kind, id, title)) for each flight sale; dated by its Paid event."""
    bookings = (
        Booking.objects.filter(status__in=FLIGHT_SALE)
        .annotate(
            sold_at=paid_at(BookingEvent),
            amount=ExpressionWrapper(
                F("unit_price") * F("passenger_count"), output_field=DecimalField(max_digits=12, decimal_places=2)
            ),
        )
        .select_related("offer__origin", "offer__destination")
    )
    return [(b.sold_at, b.amount, ("flight", None, route_line(b.offer, b.trip_type))) for b in bookings]


def hotel_sales():
    bookings = (
        HotelBooking.objects.filter(status__in=HOTEL_SALE)
        .annotate(sold_at=paid_at(HotelBookingEvent))
        .select_related("hotel")
    )
    return [(b.sold_at, b.total, ("hotel", str(b.hotel_id), b.hotel.name)) for b in bookings]


def tour_sales():
    """Tour bookings count when booked, until cancelled."""
    total = (
        TourBookingLine.objects.filter(booking=OuterRef("pk"))
        .values("booking")
        .annotate(total=Sum(F("unit_price") * F("quantity")))
        .values("total")
    )
    bookings = (
        TourBooking.objects.filter(status__in=TOUR_SALE)
        .annotate(amount=Subquery(total, output_field=DecimalField(max_digits=12, decimal_places=2)))
        .select_related("tour")
    )
    return [(b.created_at, b.amount, ("tour", str(b.tour_id), b.tour.title)) for b in bookings]


SALES = {"flights": flight_sales, "tours": tour_sales, "hotels": hotel_sales}


def summary():
    """Every figure of the modules the agency has on."""
    tenant = this_tenant()
    modules = [module for module in MODULES if tenant.has_module(module)]
    customers = get_user_model().objects.filter(role="customer", is_active=True)
    today = timezone.localdate()
    return {
        "modules": modules,
        "needs_action": needs_action(modules, today),
        **sales(modules, today),
        "payments_due": payments_due(modules),
        "this_week": this_week(modules, today),
        "customers": {
            "total": customers.count(),
            "new_this_month": customers.filter(date_joined__gte=start_of(today.replace(day=1))).count(),
        },
        "on_sale": {module: ON_SALE[module](today) for module in modules},
        "overdue_invoice": overdue_notice(tenant),
    }


def start_of(day):
    return timezone.make_aware(datetime(day.year, day.month, day.day))


def needs_action(modules, today):
    counts = {}
    if "flights" in modules:
        by_status = dict(Booking.objects.values_list("status").annotate(count=Count("pk")))
        counts.update(
            bookings_requested=by_status.get(Booking.Status.REQUESTED, 0),
            bookings_paid_awaiting_boarding_pass=by_status.get(Booking.Status.PAID, 0),
            open_queries=Query.objects.filter(status=Query.Status.OPEN).count(),
            bookings_awaiting_payment=by_status.get(Booking.Status.AVAILABILITY_CONFIRMED, 0),
            new_fares=Fare.objects.filter(status=Fare.Status.NEW, picked=True).count(),
        )
    if "tours" in modules:
        counts["travellers_missing"] = (
            confirmed_tour_bookings()
            .filter(tour__start_date__gte=today, tour__start_date__lte=today + timedelta(days=WEEK_DAYS))
            .filter(added__lt=F("people"))
            .count()
        )
    if "hotels" in modules:
        by_status = dict(HotelBooking.objects.values_list("status").annotate(count=Count("pk")))
        counts.update(
            hotel_to_confirm=by_status.get(HotelBooking.Status.REQUESTED, 0),
            hotel_awaiting_payment=by_status.get(HotelBooking.Status.AVAILABILITY_CONFIRMED, 0),
            hotel_vouchers_due=by_status.get(HotelBooking.Status.PAID, 0),
        )
    return counts


def confirmed_tour_bookings():
    """Confirmed bookings on tours not cancelled, with the travellers added."""
    return TourBooking.objects.filter(status=TourBooking.Status.CONFIRMED, tour__cancelled_at__isnull=True).annotate(
        added=Count("lines__travellers")
    )


def sales(modules, today):
    month_start = today.replace(day=1)
    year_start = date(today.year, 1, 1)
    months = [month_start - relativedelta(months=back) for back in range(MONTHS_SHOWN - 1, -1, -1)]
    zero = {module: ZERO for module in modules}
    periods = {"this_month": dict(zero), "this_year": dict(zero), "all_time": dict(zero)}
    by_month = {month: {"count": 0, "amounts": dict(zero)} for month in months}
    sellers = defaultdict(lambda: {"count": 0, "total": ZERO})
    count_this_month = 0

    for module in modules:
        for sold_at, amount, key in SALES[module]():
            amount = amount or ZERO
            day = timezone.localtime(sold_at).date()
            periods["all_time"][module] += amount
            if day >= year_start:
                periods["this_year"][module] += amount
                sellers[key]["count"] += 1
                sellers[key]["total"] += amount
            if day >= month_start:
                periods["this_month"][module] += amount
                count_this_month += 1
            month = by_month.get(day.replace(day=1))
            if month is not None:
                month["count"] += 1
                month["amounts"][module] += amount

    def amounts(by_module):
        return {"total": money(sum(by_module.values(), ZERO)), "by_module": {m: money(a) for m, a in by_module.items()}}

    top = sorted(sellers.items(), key=lambda item: (-item[1]["total"], -item[1]["count"], item[0][2]))
    return {
        "sales": {**{name: amounts(values) for name, values in periods.items()}, "count_this_month": count_this_month},
        "sales_by_month": [
            {"month": f"{month:%Y-%m}", "count": by_month[month]["count"], **amounts(by_month[month]["amounts"])}
            for month in months
        ],
        "top_sellers": [
            {"kind": kind, "id": pk, "title": title, "count": figures["count"], "total": money(figures["total"])}
            for (kind, pk, title), figures in top[:LIST_SIZE]
        ],
    }


def payments_due(modules):
    now = timezone.now()
    window = {"payment_deadline__gte": now, "payment_deadline__lte": now + PAYMENTS_DUE_WITHIN}
    rows = []
    if "flights" in modules:
        bookings = Booking.objects.filter(status=Booking.Status.AVAILABILITY_CONFIRMED, **window).select_related(
            "user", "offer__origin", "offer__destination"
        )
        rows += [
            {
                "kind": "flight",
                "id": str(b.pk),
                "customer": customer(b),
                "title": route_line(b.offer, b.trip_type),
                "total": money(b.total_price),
                "payment_deadline": b.payment_deadline,
            }
            for b in bookings.order_by("payment_deadline")[:LIST_SIZE]
        ]
    if "hotels" in modules:
        bookings = HotelBooking.objects.filter(status=HotelBooking.Status.AVAILABILITY_CONFIRMED, **window)
        rows += [
            {
                "kind": "hotel",
                "id": str(b.pk),
                "customer": customer(b),
                "title": b.hotel.name,
                "total": money(b.total),
                "payment_deadline": b.payment_deadline,
            }
            for b in bookings.select_related("user", "hotel").order_by("payment_deadline")[:LIST_SIZE]
        ]
    rows.sort(key=lambda row: row["payment_deadline"])
    return rows[:LIST_SIZE]


def this_week(modules, today):
    """What starts from today to 7 days ahead: flight departures, tour starts and hotel check-ins."""
    last = today + timedelta(days=WEEK_DAYS)
    rows = []
    if "flights" in modules:
        # A booking's own first outbound flight, or its offer's date.
        first_flight = BookingSegment.objects.filter(
            booking=OuterRef("pk"), direction=Segment.Direction.OUTBOUND
        ).order_by("position")
        departures = (
            Booking.objects.filter(status__in=FLIGHT_SALE)
            .annotate(
                departure=Coalesce(Subquery(first_flight.values("departure_date")[:1]), F("offer__departure_date"))
            )
            .filter(departure__gte=today, departure__lte=last)
            .select_related("user", "offer__origin", "offer__destination")
            .order_by("departure", "created_at")[:THIS_WEEK_SIZE]
        )
        rows += [
            {
                "kind": "flight",
                "id": str(b.pk),
                "date": b.departure,
                "title": route_line(b.offer, b.trip_type),
                "customer": customer(b),
                "passenger_count": b.passenger_count,
                "boarding_passes_sent": b.status == Booking.Status.COMPLETED,
            }
            for b in departures
        ]
    if "tours" in modules:
        bookings = confirmed_tour_bookings().filter(tour__start_date__gte=today, tour__start_date__lte=last)
        missing = defaultdict(int)
        for booking in bookings:
            missing[booking.tour_id] += max(booking.people - booking.added, 0)
        tours = (
            Tour.objects.with_figures()
            .filter(pk__in=bookings.values("tour"))
            .order_by("start_date", "title")[:THIS_WEEK_SIZE]
        )
        rows += [
            {
                "kind": "tour",
                "id": str(tour.pk),
                "date": tour.start_date,
                "title": tour.title,
                "booked": tour.booked,
                "slots": tour.slots,
                "travellers_missing": missing[tour.pk],
            }
            for tour in tours
        ]
    if "hotels" in modules:
        check_ins = (
            HotelBooking.objects.filter(status__in=HOTEL_SALE, check_in__gte=today, check_in__lte=last)
            .annotate(room_count=Count("rooms"))
            .select_related("user", "hotel")
            .order_by("check_in", "created_at")[:THIS_WEEK_SIZE]
        )
        rows += [
            {
                "kind": "hotel",
                "id": str(b.pk),
                "date": b.check_in,
                "title": b.hotel.name,
                "customer": customer(b),
                "nights": b.nights,
                "rooms": b.room_count,
                "voucher_sent": b.status == HotelBooking.Status.COMPLETED,
            }
            for b in check_ins
        ]
    rows.sort(key=lambda row: (row["date"], KIND_ORDER[row["kind"]]))
    return rows[:THIS_WEEK_SIZE]


def flights_on_sale(today):
    bookable = Offer.objects.bookable()
    searches = None
    if Integration.objects.exists():
        usage = search_usage()
        searches = {"used": usage["used"], "allowance": usage["allowance"]}
    return {
        "bookable": bookable.count(),
        "public_bookable": bookable.filter(is_public=True).count(),
        "expiring_soon": bookable.filter(valid_until__lte=today + timedelta(days=EXPIRING_WITHIN_DAYS)).count(),
        "featured": bookable.filter(is_public=True, is_featured=True).count(),
        "searches": searches,
    }


def tours_on_sale(today):
    upcoming = Tour.objects.with_figures().filter(is_active=True, cancelled_at__isnull=True, start_date__gt=today)
    seats = upcoming.aggregate(sold=Sum("booked"), total=Sum("slots"))
    bookable = Tour.objects.bookable()
    return {
        "upcoming": bookable.count(),
        "fully_booked": Tour.objects.listed().exclude(pk__in=bookable.values("pk")).count(),
        "seats_sold": seats["sold"] or 0,
        "seats_total": seats["total"] or 0,
        "featured": bookable.filter(is_featured=True).count(),
    }


def hotels_on_sale(today):
    listed = [hotel for hotel in pricing.public_hotels() if pricing.from_price(hotel) is not None]
    horizon = today + timedelta(days=PRICES_AHEAD_DAYS)

    def prices_end_soon(hotel):
        return not any(p.end_date > horizon for rate in pricing.current_rates(hotel) for p in rate.periods.all())

    return {
        "listed": len(listed),
        "prices_ending": sum(1 for hotel in listed if prices_end_soon(hotel)),
        "featured": sum(1 for hotel in listed if hotel.is_featured),
    }


ON_SALE = {"flights": flights_on_sale, "tours": tours_on_sale, "hotels": hotels_on_sale}
