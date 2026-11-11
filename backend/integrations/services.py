"""Searching routes through the agency's providers, picking among the fares found, and publishing them as offers."""

import logging
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db import connection, transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.status import HTTP_502_BAD_GATEWAY
from rest_framework.exceptions import APIException, ValidationError

import rates
from airlines.models import Airline
from airports.models import Airport
from bookings.models import Booking
from catalog.itinerary import derived_fields, itinerary_errors
from catalog.models import Offer, OfferSegment, Segment, Trip
from core.exceptions import Conflict
from core.tenancy import queue
from tenants.models import Tenant

from .models import Fare, Integration, Route, SearchRun
from .providers import ProviderError, SearchRequest, provider_for

logger = logging.getLogger(__name__)

CENT = Decimal("0.01")
MAX_SEARCH_DAYS = 60
FARES_KEPT_DAYS = 30
# Publishing defaults: valid for a week (never after departure), public, at the selling price.
PUBLISH_VALID_DAYS = 7
FLIGHT_NUMBER = re.compile(r"^\d{1,4}[A-Z]?$")


# Allowance


def this_tenant():
    return Tenant.objects.get(schema_name=connection.schema_name)


def month_start():
    """The start of the current calendar month in Nairobi time."""
    first = timezone.localdate().replace(day=1)
    return timezone.make_aware(datetime.combine(first, time.min))


def searches_this_month():
    """Searches made by the current agency's runs this month."""
    return SearchRun.objects.filter(created_at__gte=month_start()).aggregate(total=Sum("searches_made"))["total"] or 0


def search_usage():
    allowance = this_tenant().monthly_search_allowance
    used = searches_this_month()
    return {"allowance": allowance, "used": used, "left": max(allowance - used, 0)}


# Starting a run


def search_dates(route, date_from, date_to):
    """The departure dates from date_from to date_to (inclusive) on the route's weekdays."""
    days = [date_from + timedelta(days=offset) for offset in range((date_to - date_from).days + 1)]
    return [day for day in days if not route.weekdays or day.weekday() in route.weekdays]


def search_integrations(route):
    """The route's chosen integrations that are active, or every active one when it chose none."""
    chosen = route.integrations.all()
    return list((chosen if chosen.exists() else Integration.objects.all()).filter(is_active=True))


def window_dates(route, today):
    """The first and last departure date of the route's window as it stands today."""
    if route.window == Route.Window.ROLLING:
        return today + timedelta(days=route.days_ahead_from), today + timedelta(days=route.days_ahead_to)
    return route.window_from, route.window_to


def start_search(route, user=None, trigger=SearchRun.Trigger.MANUAL):
    """Queues a run of the route over its window (the part not yet past).

    A manual search that cannot start (no date left, no integration, over this month's allowance) is refused with
    409; a scheduled one is recorded as a skipped run with the reason instead.
    """
    if not route.is_active:
        raise Conflict("Activate the route before searching it.")
    today = timezone.localdate()
    window_from, window_to = window_dates(route, today)
    date_from = max(window_from, today)
    with transaction.atomic():
        # One search start at a time per agency, so two cannot both fit in what is left.
        tenant = Tenant.objects.select_for_update().get(schema_name=connection.schema_name)
        try:
            needed = searches_needed(route, date_from, window_to)
            left = max(tenant.monthly_search_allowance - searches_this_month(), 0)
            if needed > left:
                raise Conflict(f"This search needs {needed} searches, but only {left} are left this month.")
        except Conflict as exc:
            if trigger == SearchRun.Trigger.MANUAL:
                raise
            return SearchRun.objects.create(
                route=route,
                trigger=trigger,
                date_from=window_from,
                date_to=window_to,
                status=SearchRun.Status.SKIPPED,
                errors=[str(exc.detail)],
                finished_at=timezone.now(),
            )
        run = SearchRun.objects.create(
            route=route, trigger=trigger, date_from=date_from, date_to=window_to, started_by=user, searches_made=needed
        )
        from .tasks import run_search

        queue(run_search, str(run.pk))
    return run


def searches_needed(route, date_from, date_to):
    """Departure dates × integrations; Conflict when there is nothing to search."""
    if date_to < date_from:
        raise Conflict("The route's dates have passed.")
    integrations = search_integrations(route)
    if not integrations:
        raise Conflict("There is no active integration to search with.")
    dates = search_dates(route, date_from, date_to)
    if not dates:
        raise Conflict("No date in the route's window falls on its departure days.")
    return len(dates) * len(integrations)


# Scheduled runs

# Scheduled searches start from this hour (Nairobi time).
SCHEDULE_HOUR = 2


def due_routes():
    """Active scheduled routes due now: daily ones without a scheduled run today, weekly ones on their weekday
    without a scheduled run this week. A skipped run counts, so a skip is recorded once."""
    now = timezone.localtime()
    if now.hour < SCHEDULE_HOUR:
        return []
    today = now.date()
    day_start = timezone.make_aware(datetime.combine(today, time.min))
    week_start = day_start - timedelta(days=today.weekday())
    scheduled = SearchRun.objects.filter(trigger=SearchRun.Trigger.SCHEDULED)
    routes = Route.objects.select_related("origin", "destination").filter(is_active=True)
    daily = routes.filter(schedule=Route.Schedule.DAILY).exclude(
        pk__in=scheduled.filter(created_at__gte=day_start).values("route")
    )
    weekly = routes.filter(schedule=Route.Schedule.WEEKLY, schedule_weekday=today.weekday()).exclude(
        pk__in=scheduled.filter(created_at__gte=week_start).values("route")
    )
    return [*daily, *weekly]


def run_due_route_searches():
    """Starts a scheduled run of every due route; returns how many started (skipped ones not counted)."""
    started = 0
    for route in due_routes():
        try:
            run = start_search(route, trigger=SearchRun.Trigger.SCHEDULED)
        except Exception:
            logger.exception("Scheduled search of route %s failed to start.", route.pk)
            continue
        if run.status == SearchRun.Status.SKIPPED:
            logger.info("Scheduled search of route %s skipped: %s", route.pk, run.errors[0])
        else:
            started += 1
    return started


# Running


def markup(net_usd, route):
    return (net_usd * (1 + route.markup_percent / 100) + route.markup_fixed).quantize(CENT, ROUND_HALF_UP)


def fare_key(segments, cabin):
    """The flights (carrier, number, date) of every segment plus the cabin: the same fare whoever found it."""
    flights = "-".join(
        f"{s['airline'].iata_code}{s['flight_number']}@{s['departure_date'].isoformat()}" for s in segments
    )
    return f"{flights}/{cabin}"


def stored_segments(segments):
    """Segment dicts with model instances, as JSON in the shape offers take them."""
    return [
        {
            "direction": s["direction"],
            "airline": str(s["airline"].pk),
            "flight_number": s["flight_number"],
            "operating_airline": str(s["operating_airline"].pk) if s["operating_airline"] else None,
            "origin": s["origin"].code,
            "destination": s["destination"].code,
            "departure_date": s["departure_date"].isoformat(),
            "departure_time": s["departure_time"].strftime("%H:%M"),
            "arrival_date": s["arrival_date"].isoformat(),
            "arrival_time": s["arrival_time"].strftime("%H:%M"),
        }
        for s in segments
    ]


class Lookup:
    """Airlines by IATA code and airports by code, loaded once per run."""

    def __init__(self):
        self.airlines = {a.iata_code: a for a in Airline.objects.all()}
        self.airports = {}

    def airport(self, code):
        if code not in self.airports:
            self.airports[code] = Airport.objects.filter(code=code).first()
        return self.airports[code]


def _segments_of(result, lookup):
    """The result's segments with model instances, or (None, why it is skipped)."""
    segments = []
    for flight in result.segments:
        airline = lookup.airlines.get(flight.airline)
        if airline is None:
            return None, f"airline {flight.airline} is not in the airline list"
        operating = None
        if flight.operating_airline:
            operating = lookup.airlines.get(flight.operating_airline)
            if operating is None:
                return None, f"airline {flight.operating_airline} is not in the airline list"
        if not FLIGHT_NUMBER.match(flight.flight_number.upper()):
            return None, f"flight {flight.airline} {flight.flight_number} has an unusable flight number"
        origin, destination = lookup.airport(flight.origin), lookup.airport(flight.destination)
        for code, airport in ((flight.origin, origin), (flight.destination, destination)):
            if airport is None:
                return None, f"airport {code} is not in the airport list"
        segments.append(
            {
                "direction": flight.direction,
                "airline": airline,
                "flight_number": flight.flight_number.upper(),
                "operating_airline": operating,
                "origin": origin,
                "destination": destination,
                "departure_date": flight.departure_date,
                "departure_time": flight.departure_time,
                "arrival_date": flight.arrival_date,
                "arrival_time": flight.arrival_time,
            }
        )
    return segments, None


def check_result(result, lookup, trip_type, origin, destination):
    """(segments with model instances, ticketing airline, None) for a result that fits the trip, or
    (None, None, why it is skipped)."""
    segments, problem = _segments_of(result, lookup)
    if problem:
        return None, None, problem
    found_type = (
        Trip.TripType.RETURN
        if any(s["direction"] == Segment.Direction.RETURN for s in segments)
        else Trip.TripType.ONE_WAY
    )
    if found_type != trip_type:
        return None, None, "the trip type does not match the route"
    if errors := itinerary_errors(trip_type, segments, route=(origin, destination)):
        return None, None, errors[0].rstrip(".")
    airline = lookup.airlines.get(result.airline)
    if airline is None:
        return None, None, f"airline {result.airline} is not in the airline list"
    if not airline.is_active:
        return None, None, f"{airline.name} is no longer active"
    if result.ticket_class not in Offer.TicketClass.values:
        return None, None, f"unknown cabin {result.ticket_class}"
    if result.checked_bags > Trip.MAX_CHECKED_BAGS:
        return None, None, f"more than {Trip.MAX_CHECKED_BAGS} checked bags"
    return segments, airline, None


def build_fare(run, integration, result, lookup, on):
    """An unsaved Fare for a result, or (None, why it is skipped)."""
    route = run.route
    segments, airline, problem = check_result(result, lookup, route.trip_type, route.origin, route.destination)
    if problem:
        return None, problem

    fare = Fare(
        run=run,
        route=route,
        integration=integration,
        itinerary=stored_segments(segments),
        trip_type=route.trip_type,
        ticket_class=result.ticket_class,
        airline=airline,
        net_amount=result.net_amount,
        net_currency=result.net_currency.upper(),
        checked_bags=result.checked_bags,
        checked_bag_kg=result.checked_bag_kg,
        cabin_bag_kg=result.cabin_bag_kg,
        refund_policy=result.refund_policy,
        change_policy=result.change_policy,
        fare_type=result.fare_type,
        seats_left=result.seats_left,
        provider_ref=result.provider_ref,
        fare_key=fare_key(segments, result.ticket_class),
        expires_at=result.expires_at,
    )
    try:
        conversion = rates.convert(fare.net_amount, fare.net_currency, on=on)
    except rates.NoRate:
        fare.no_rate = True
    else:
        fare.net_usd, fare.rate, fare.rate_date = conversion.usd, conversion.rate, conversion.rate_date
        fare.selling_price = markup(conversion.usd, route)
    return fare, None


def execute_run(run):
    """Searches every date with every integration, stores the valid results and picks among them.

    A provider error is recorded and the run goes on with the next search.
    """
    route = run.route
    run.status = SearchRun.Status.RUNNING
    run.save(update_fields=["status"])
    on = timezone.localdate(run.created_at)
    problems = Counter()
    fares = []
    # Departure dates at least one integration answered for: only there can an offer be "not found".
    searched_days = set()
    failed_searches = made = 0
    try:
        integrations = search_integrations(route)
        lookup = Lookup()
        for day in search_dates(route, run.date_from, run.date_to):
            request = SearchRequest(
                origin=route.origin.code,
                destination=route.destination.code,
                departure_date=day,
                return_date=day + timedelta(days=route.stay_nights)
                if route.trip_type == Trip.TripType.RETURN
                else None,
                cabin=route.ticket_class,
                max_connections=route.max_connections,
            )
            for integration in integrations:
                made += 1
                try:
                    results = provider_for(integration).search(request)
                except ProviderError as exc:
                    failed_searches += 1
                    problems[f"{integration.name}, {day:%d %b}: {exc}"] += 1
                    continue
                searched_days.add(day)
                for result in results:
                    fare, problem = build_fare(run, integration, result, lookup, on)
                    if problem:
                        problems[f"{integration.name}: skipped, {problem}"] += 1
                    else:
                        fares.append(fare)
        with transaction.atomic():
            Fare.objects.bulk_create(fares)
            pick(run)
        status = SearchRun.Status.FAILED if made and failed_searches == made else SearchRun.Status.DONE
    except Exception:
        logger.exception("Search run %s failed.", run.pk)
        problems["The search stopped on an unexpected error."] += 1
        status = SearchRun.Status.FAILED
    run.status = status
    run.searches_made = made
    run.fares_found = len(fares)
    run.errors = [f"{message} ({count}×)" if count > 1 else message for message, count in problems.items()]
    run.finished_at = timezone.now()
    run.save(update_fields=["status", "searches_made", "fares_found", "errors", "finished_at"])
    if status == SearchRun.Status.DONE:
        try:
            refresh_offers(run, searched_days)
            if route.auto_publish:
                run.errors += auto_publish(run)
        except Exception:
            logger.exception("Updating offers after search run %s failed.", run.pk)
            run.errors.append("Updating the route's offers stopped on an unexpected error.")
        run.save(update_fields=["errors"])
    return run


def refresh_offers(run, searched_days):
    """Brings the route's active GDS offers departing on the searched dates up to date with the run's fares.

    Found (a fare with the same fare_key, the cheapest in USD): its net amount, currency and conversion, the selling
    price at the run's rate (in review mode only while the admin has not edited the price) and price_checked_at.
    Not found: deactivated on an auto-publish route, otherwise marked missing.
    """
    route = run.route
    found = {}
    for fare in run.fares.all():
        kept = found.get(fare.fare_key)
        if kept is None or kept.net_usd is None or (fare.net_usd is not None and fare.net_usd < kept.net_usd):
            found[fare.fare_key] = fare
    with transaction.atomic():
        offers = Offer.objects.select_for_update().filter(
            route=route, source=Offer.Source.GDS, is_active=True, departure_date__in=searched_days
        )
        for offer in offers:
            fare = found.get(offer.fare_key)
            if fare is None:
                if route.auto_publish:
                    offer.is_active = False
                    offer.save(update_fields=["is_active"])
                elif offer.missing_since is None:
                    offer.missing_since = run.finished_at
                    offer.save(update_fields=["missing_since"])
                continue
            offer.missing_since = None
            fields = ["missing_since"]
            # Without a rate the fare cannot be priced in USD; the offer is only marked as found.
            if not fare.no_rate:
                offer.net_amount, offer.net_currency = fare.net_amount, fare.net_currency
                offer.net_usd, offer.rate, offer.rate_date = fare.net_usd, fare.rate, fare.rate_date
                offer.price_checked_at = run.finished_at
                fields += ["net_amount", "net_currency", "net_usd", "rate", "rate_date", "price_checked_at"]
                if route.auto_publish or not offer.price_edited:
                    offer.price = fare.selling_price
                    fields.append("price")
            offer.save(update_fields=fields)


def auto_publish(run):
    """Publishes the run's picked fares with the publish dialog's defaults; returns why any could not be."""
    problems = []
    today = timezone.localdate()
    for fare in run.fares.filter(picked=True, status=Fare.Status.NEW, no_rate=False):
        departure = date.fromisoformat(fare.departure_date)
        valid_until = min(today + timedelta(days=PUBLISH_VALID_DAYS), departure)
        try:
            publish(fare.pk, fare.selling_price, valid_until, is_public=True)
        except (Conflict, ValidationError) as exc:
            detail = exc.detail if isinstance(exc.detail, str) else next(iter(exc.detail.values()))[0]
            problems.append(f"Not published, {fare.fare_key}: {detail}")
    return problems


def connection_count(itinerary):
    """Connections in the direction with the most."""
    counts = Counter(s["direction"] for s in itinerary)
    return max(counts.values()) - 1


def departure_of(itinerary):
    return itinerary[0]["departure_date"]


def pick(run):
    """Marks the run's chosen fares as picked, and earlier new fares for the same dates as no longer picked.

    Filtered by the route's cabin, connections and airlines; the same flights found by several integrations count
    once, at the cheapest USD amount; then per departure date the route's pick rule applies.
    """
    route = run.route
    airline_ids = set(route.airlines.values_list("pk", flat=True))
    cheapest = {}
    for fare in run.fares.filter(no_rate=False, ticket_class=route.ticket_class):
        if airline_ids and fare.airline_id not in airline_ids:
            continue
        if route.max_connections is not None and connection_count(fare.itinerary) > route.max_connections:
            continue
        kept = cheapest.get(fare.fare_key)
        if kept is None or fare.net_usd < kept.net_usd:
            cheapest[fare.fare_key] = fare
    per_date = defaultdict(list)
    for fare in cheapest.values():
        per_date[departure_of(fare.itinerary)].append(fare)

    picked = set()
    for fares in per_date.values():
        fares.sort(key=lambda fare: fare.net_usd)
        if route.pick_cheapest:
            picked.update(fare.pk for fare in fares[: route.max_per_date])
        if route.pick_cheapest_direct:
            direct = next((fare for fare in fares if connection_count(fare.itinerary) == 0), None)
            if direct:
                picked.add(direct.pk)

    dates = [day.isoformat() for day in search_dates(route, run.date_from, run.date_to)]
    Fare.objects.filter(
        route=route, status=Fare.Status.NEW, picked=True, itinerary__0__departure_date__in=dates
    ).exclude(run=run).update(picked=False)
    Fare.objects.filter(pk__in=picked).update(picked=True)


def delete_old_fares():
    """Fares older than 30 days, except published ones."""
    cutoff = timezone.now() - timedelta(days=FARES_KEPT_DAYS)
    deleted, _ = Fare.objects.filter(created_at__lt=cutoff).exclude(status=Fare.Status.PUBLISHED).delete()
    return deleted


# Reading fares back


def resolve_itineraries(fares):
    """{fare id: its segments with model instances} for stored fares."""
    airline_ids = {s[f] for fare in fares for s in fare.itinerary for f in ("airline", "operating_airline") if s[f]}
    codes = {s[f] for fare in fares for s in fare.itinerary for f in ("origin", "destination")}
    airlines = {str(a.pk): a for a in Airline.objects.filter(pk__in=airline_ids)}
    airports = {a.code: a for a in Airport.objects.filter(code__in=codes)}
    return {
        fare.pk: [
            {
                "direction": s["direction"],
                "airline": airlines[s["airline"]],
                "flight_number": s["flight_number"],
                "operating_airline": airlines[s["operating_airline"]] if s["operating_airline"] else None,
                "origin": airports[s["origin"]],
                "destination": airports[s["destination"]],
                "departure_date": date.fromisoformat(s["departure_date"]),
                "departure_time": time.fromisoformat(s["departure_time"]),
                "arrival_date": date.fromisoformat(s["arrival_date"]),
                "arrival_time": time.fromisoformat(s["arrival_time"]),
            }
            for s in fare.itinerary
        ]
        for fare in fares
    }


def segment_rows(segments):
    """Unsaved OfferSegments for segment dicts, so fares render like offers."""
    return OfferSegment.build(segments)


# Publishing


def publish(fare_id, price, valid_until, is_public):
    """A GDS offer from the fare, or the active offer with the same flights updated with its price and conversion."""
    with transaction.atomic():
        fare = Fare.objects.select_for_update().select_related("run", "airline").get(pk=fare_id)
        if fare.status != Fare.Status.NEW:
            raise Conflict("Only a new fare can be published.")
        if fare.no_rate:
            raise Conflict(f"There is no exchange rate for {fare.net_currency} yet, so this fare cannot be published.")
        segments = resolve_itineraries([fare])[fare.pk]
        derived = derived_fields(segments)
        errors = itinerary_errors(fare.trip_type, segments)
        if not fare.airline.is_active:
            errors.append(f"{fare.airline.name} is no longer active.")
        if errors:
            raise Conflict(errors[0])
        if valid_until > derived["departure_date"]:
            raise ValidationError({"valid_until": "Valid until must be on or before the departure date."})
        if valid_until < timezone.localdate():
            raise ValidationError({"valid_until": "Valid until cannot be in the past."})

        source = {
            "net_amount": fare.net_amount,
            "net_currency": fare.net_currency,
            "net_usd": fare.net_usd,
            "rate": fare.rate,
            "rate_date": fare.rate_date,
            "price_checked_at": fare.run.finished_at or fare.run.created_at,
        }
        offer = Offer.objects.select_for_update().filter(is_active=True, fare_key=fare.fare_key).first()
        if offer is not None:
            # Found and priced again: no longer missing, and the price is the one just chosen.
            updates = {"price": price, **source, "missing_since": None, "price_edited": False}
            for field, value in updates.items():
                setattr(offer, field, value)
            offer.save(update_fields=list(updates))
        else:
            offer = Offer.objects.create(
                **derived,
                trip_type=fare.trip_type,
                ticket_class=fare.ticket_class,
                price=price,
                airline=fare.airline,
                valid_until=valid_until,
                is_public=is_public,
                checked_bags=fare.checked_bags,
                checked_bag_kg=fare.checked_bag_kg,
                cabin_bag_kg=fare.cabin_bag_kg,
                refund_policy=fare.refund_policy,
                change_policy=fare.change_policy,
                source=Offer.Source.GDS,
                integration=fare.integration,
                route=fare.route,
                provider_ref=fare.provider_ref,
                fare_key=fare.fare_key,
                fare_type=fare.fare_type,
                **source,
            )
            offer.set_segments(segments)
        fare.status = Fare.Status.PUBLISHED
        fare.offer = offer
        fare.save(update_fields=["status", "offer"])
    return fare


def dismiss(fare_id):
    with transaction.atomic():
        fare = Fare.objects.select_for_update().get(pk=fare_id)
        if fare.status == Fare.Status.PUBLISHED:
            raise Conflict("A published fare cannot be dismissed.")
        fare.status = Fare.Status.DISMISSED
        fare.save(update_fields=["status"])
    return fare


def price_history(route, departure_date):
    """The cheapest USD fare of each run that found fares for the route on that departure date, oldest run first."""
    cheapest = {}
    fares = Fare.objects.filter(
        route=route, net_usd__isnull=False, itinerary__0__departure_date=departure_date.isoformat()
    ).select_related("run")
    for fare in fares:
        kept = cheapest.get(fare.run_id)
        if kept is None or fare.net_usd < kept.net_usd:
            cheapest[fare.run_id] = fare
    return sorted(cheapest.values(), key=lambda fare: fare.run.created_at)


# Re-checking a booking's fare

# How many other fares a re-check returns when the booked flights are not found.
RECHECK_ALTERNATIVES = 3


class ProviderFailed(APIException):
    """The provider could not answer a search made while the admin waits."""

    status_code = HTTP_502_BAD_GATEWAY
    default_detail = "The fare provider could not be searched."
    default_code = "provider_error"


@dataclass
class CheckedFare:
    """A result of a re-check, priced in USD now with the offer's route's markup; the USD fields are None (and
    no_rate set) when its currency has no rate."""

    fare_key: str
    airline: Airline
    ticket_class: str
    segments: list
    net_amount: Decimal
    net_currency: str
    net_usd: Decimal | None = None
    rate: Decimal | None = None
    rate_date: date | None = None
    no_rate: bool = False
    selling_price: Decimal | None = None


@dataclass
class Recheck:
    # The booked fare_key's cheapest result, or None when it was not found.
    fare: CheckedFare | None
    # Only when not found: the cheapest other fares in the booking's cabin with a rate, one per fare_key.
    alternatives: list


def recheck_fare(booking, user):
    """Searches the booking's flights again (its dates, route, cabin and trip type) through its integration.

    One search, counted against the allowance as a run of the offer's route (trigger recheck) that stores no fares.
    Nothing about the booking changes: the admin applies the answer by confirming availability.
    """
    offer = booking.offer
    route = offer.route
    if booking.source != Offer.Source.GDS or booking.integration is None or route is None:
        raise Conflict("This booking's offer was entered by hand, so it has no fare to re-check.")
    if booking.status != Booking.Status.REQUESTED:
        raise Conflict("Only a requested booking's fare can be re-checked.")
    integration = booking.integration
    if not integration.is_active:
        raise Conflict(f"{integration.name} is disabled. Enable it in Settings to re-check this fare.")

    booked = [s.as_data() for s in booking.segments.select_related("airline", "origin", "destination")]
    departure = booked[0]["departure_date"]
    with transaction.atomic():
        tenant = Tenant.objects.select_for_update().get(schema_name=connection.schema_name)
        left = max(tenant.monthly_search_allowance - searches_this_month(), 0)
        if left < 1:
            raise Conflict(f"This re-check needs 1 search, but only {left} are left this month.")
        run = SearchRun.objects.create(
            route=route,
            trigger=SearchRun.Trigger.RECHECK,
            date_from=departure,
            date_to=departure,
            status=SearchRun.Status.RUNNING,
            searches_made=1,
            started_by=user,
        )

    request = SearchRequest(
        origin=offer.origin.code,
        destination=offer.destination.code,
        departure_date=departure,
        return_date=booking.return_date,
        cabin=offer.ticket_class,
        # As many connections as the booking has, so its own flights can be found.
        max_connections=connection_count(booked),
    )
    try:
        results = provider_for(integration).search(request)
    except ProviderError as exc:
        _finish_recheck(run, SearchRun.Status.FAILED, 0, [f"{integration.name}, {departure:%d %b}: {exc}"])
        raise ProviderFailed(f"{integration.name} could not be searched: {exc}")
    except Exception:
        _finish_recheck(run, SearchRun.Status.FAILED, 0, ["The search stopped on an unexpected error."])
        raise

    today = timezone.localdate()
    lookup = Lookup()
    checked, problems = [], Counter()
    for result in results:
        segments, airline, problem = check_result(result, lookup, booking.trip_type, offer.origin, offer.destination)
        if problem:
            problems[f"{integration.name}: skipped, {problem}"] += 1
            continue
        fare = CheckedFare(
            fare_key=fare_key(segments, result.ticket_class),
            airline=airline,
            ticket_class=result.ticket_class,
            segments=segments,
            net_amount=result.net_amount,
            net_currency=result.net_currency.upper(),
        )
        try:
            conversion = rates.convert(fare.net_amount, fare.net_currency, on=today)
        except rates.NoRate:
            fare.no_rate = True
        else:
            fare.net_usd, fare.rate, fare.rate_date = conversion.usd, conversion.rate, conversion.rate_date
            fare.selling_price = markup(conversion.usd, route)
        checked.append(fare)
    errors = [f"{message} ({count}×)" if count > 1 else message for message, count in problems.items()]
    _finish_recheck(run, SearchRun.Status.DONE, len(checked), errors)

    same = [fare for fare in checked if fare.fare_key == booking.fare_key]
    if same:
        cheapest_same = min(same, key=lambda fare: (fare.no_rate, fare.net_usd or fare.net_amount))
        return Recheck(fare=cheapest_same, alternatives=[])
    cheapest = {}
    for fare in checked:
        if fare.no_rate or fare.ticket_class != offer.ticket_class:
            continue
        kept = cheapest.get(fare.fare_key)
        if kept is None or fare.net_usd < kept.net_usd:
            cheapest[fare.fare_key] = fare
    alternatives = sorted(cheapest.values(), key=lambda fare: fare.net_usd)[:RECHECK_ALTERNATIVES]
    return Recheck(fare=None, alternatives=alternatives)


def _finish_recheck(run, status, found, errors):
    run.status, run.fares_found, run.errors, run.finished_at = status, found, errors, timezone.now()
    run.save(update_fields=["status", "fares_found", "errors", "finished_at"])
