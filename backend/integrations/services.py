"""Searching routes through the agency's providers, picking among the fares found, and publishing them as offers."""

import logging
import re
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db import connection, transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

import rates
from airlines.models import Airline
from airports.models import Airport
from catalog.itinerary import derived_fields, itinerary_errors
from catalog.models import Offer, OfferSegment, Segment, Trip
from core.exceptions import Conflict
from tenants.models import Tenant

from .models import Fare, Integration, SearchRun
from .providers import ProviderError, SearchRequest, provider_for

logger = logging.getLogger(__name__)

CENT = Decimal("0.01")
MAX_SEARCH_DAYS = 60
FARES_KEPT_DAYS = 30
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


def date_range_errors(date_from, date_to):
    errors = {}
    if date_from < timezone.localdate():
        errors["date_from"] = "The first departure date cannot be in the past."
    if date_to < date_from:
        errors["date_to"] = "The last departure date must be on or after the first."
    elif (date_to - date_from).days + 1 > MAX_SEARCH_DAYS:
        errors["date_to"] = f"Search at most {MAX_SEARCH_DAYS} days at a time."
    return errors


def start_search(route, date_from, date_to, user):
    """Queues a run of the route over the dates; refused (409) when it would exceed this month's allowance."""
    if errors := date_range_errors(date_from, date_to):
        raise ValidationError(errors)
    if not route.is_active:
        raise Conflict("Activate the route before searching it.")
    integrations = search_integrations(route)
    if not integrations:
        raise Conflict("There is no active integration to search with.")
    dates = search_dates(route, date_from, date_to)
    if not dates:
        raise ValidationError({"date_to": "No date in this range falls on the route's weekdays."})
    needed = len(dates) * len(integrations)
    with transaction.atomic():
        # One search start at a time per agency, so two cannot both fit in what is left.
        tenant = Tenant.objects.select_for_update().get(schema_name=connection.schema_name)
        left = max(tenant.monthly_search_allowance - searches_this_month(), 0)
        if needed > left:
            raise Conflict(f"This search needs {needed} searches, but only {left} are left this month.")
        run = SearchRun.objects.create(
            route=route, date_from=date_from, date_to=date_to, started_by=user, searches_made=needed
        )
        from .tasks import run_search

        transaction.on_commit(lambda: run_search.delay(connection.schema_name, str(run.pk)))
    return run


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


def build_fare(run, integration, result, lookup, on):
    """An unsaved Fare for a result, or (None, why it is skipped)."""
    route = run.route
    segments, problem = _segments_of(result, lookup)
    if problem:
        return None, problem
    trip_type = (
        Trip.TripType.RETURN
        if any(s["direction"] == Segment.Direction.RETURN for s in segments)
        else Trip.TripType.ONE_WAY
    )
    if trip_type != route.trip_type:
        return None, "the trip type does not match the route"
    if errors := itinerary_errors(trip_type, segments, route=(route.origin, route.destination)):
        return None, errors[0].rstrip(".")
    airline = lookup.airlines.get(result.airline)
    if airline is None:
        return None, f"airline {result.airline} is not in the airline list"
    if not airline.is_active:
        return None, f"{airline.name} is no longer active"
    if result.ticket_class not in Offer.TicketClass.values:
        return None, f"unknown cabin {result.ticket_class}"
    if result.checked_bags > Trip.MAX_CHECKED_BAGS:
        return None, f"more than {Trip.MAX_CHECKED_BAGS} checked bags"

    fare = Fare(
        run=run,
        route=route,
        integration=integration,
        itinerary=stored_segments(segments),
        trip_type=trip_type,
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
    return run


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
            for field, value in {"price": price, **source}.items():
                setattr(offer, field, value)
            offer.save(update_fields=["price", *source])
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
