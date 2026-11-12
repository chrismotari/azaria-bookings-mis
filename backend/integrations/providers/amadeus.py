"""Amadeus: Flight Offers Search (REST, v2) with an OAuth2 client-credentials token."""

from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

import httpx
from django.conf import settings

from .base import Provider, ProviderError, Result, ResultSegment, SearchRequest

HOSTS = {"test": "https://test.api.amadeus.com", "live": "https://api.amadeus.com"}
TOKEN_PATH = "/v1/security/oauth2/token"
SEARCH_PATH = "/v2/shopping/flight-offers"
TIMEOUT_SECONDS = 60
MAX_OFFERS = 50
# The most connections Amadeus lets a search restrict to.
MAX_CONNECTIONS = 2

# The httpx transport; None uses the network (tests put an httpx.MockTransport here).
transport = None

DIRECTIONS = ["outbound", "return"]
CABINS = {"economy": "ECONOMY", "premium_economy": "PREMIUM_ECONOMY", "business": "BUSINESS", "first": "FIRST"}
TICKET_CLASSES = {value: key for key, value in CABINS.items()}
PRIVATE_FARES = {"NEGOTIATED", "CORPORATE"}


class AmadeusProvider(Provider):
    credential_fields = ["api_key", "api_secret"]

    def __init__(self, credentials, mode):
        super().__init__(credentials, mode)
        self._token = None

    def _post(self, path, **kwargs):
        try:
            with httpx.Client(base_url=HOSTS[self.mode], transport=transport, timeout=TIMEOUT_SECONDS) as client:
                response = client.post(path, **kwargs)
        except httpx.HTTPError as exc:
            raise ProviderError(f"Amadeus could not be reached ({exc.__class__.__name__}).") from exc
        if response.status_code >= 400:
            raise ProviderError(error_message(response))
        try:
            return response.json()
        except ValueError as exc:
            raise ProviderError("Amadeus sent an answer that could not be read.") from exc

    def token(self):
        """A bearer token, taken once per provider instance."""
        if self._token is None:
            data = self._post(
                TOKEN_PATH,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.credentials["api_key"],
                    "client_secret": self.credentials["api_secret"],
                },
            )
            if not data.get("access_token"):
                raise ProviderError("Amadeus sent no access token.")
            self._token = data["access_token"]
        return self._token

    def test(self):
        # Taking a token needs valid credentials and searches nothing.
        self.token()
        return "Connected to Amadeus."

    def search(self, request: SearchRequest):
        data = self._post(
            SEARCH_PATH,
            json=search_body(request),
            headers={
                "Authorization": f"Bearer {self.token()}",
                "Accept": "application/vnd.amadeus+json",
                # Amadeus's POST search is a GET with a body.
                "X-HTTP-Method-Override": "GET",
            },
        )
        offers = data.get("data")
        if not isinstance(offers, list):
            raise ProviderError("Amadeus sent an answer that could not be read.")
        return [map_offer(offer, request.cabin) for offer in offers]


def search_body(request):
    """A flight offers search for one adult in one cabin, GDS fares only."""
    legs = [(request.origin, request.destination, request.departure_date)]
    if request.return_date:
        legs.append((request.destination, request.origin, request.return_date))
    ids = [str(number) for number in range(1, len(legs) + 1)]
    filters = {
        "cabinRestrictions": [{"cabin": CABINS[request.cabin], "coverage": "ALL_SEGMENTS", "originDestinationIds": ids}]
    }
    if request.max_connections is not None:
        filters["connectionRestriction"] = {"maxNumberOfConnections": min(request.max_connections, MAX_CONNECTIONS)}
    return {
        "originDestinations": [
            {
                "id": number,
                "originLocationCode": origin,
                "destinationLocationCode": destination,
                "departureDateTimeRange": {"date": day.isoformat()},
            }
            for number, (origin, destination, day) in zip(ids, legs, strict=True)
        ],
        "travelers": [{"id": "1", "travelerType": "ADULT"}],
        "sources": ["GDS"],
        "searchCriteria": {"maxFlightOffers": MAX_OFFERS, "flightFilters": filters},
    }


def error_message(response):
    try:
        data = response.json()
    except ValueError:
        data = {}
    detail = None
    if isinstance(data, dict):
        errors = data.get("errors") or []
        if errors and isinstance(errors[0], dict):
            detail = errors[0].get("detail") or errors[0].get("title")
        detail = detail or data.get("error_description")
    return f"Amadeus error {response.status_code}: {detail}" if detail else f"Amadeus error {response.status_code}."


def _local(value):
    """A segment's local date and time; Amadeus gives them without an offset."""
    try:
        moment = datetime.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise ProviderError(f"Amadeus sent an unreadable time ({value}).") from exc
    return moment.date(), moment.time().replace(second=0, microsecond=0)


def _amount(value):
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ProviderError(f"Amadeus sent an unreadable price ({value}).") from exc


def _bags(details):
    """(checked bags, kilograms or None): the fewest across segments; a weight alone is one bag."""
    counts, weights = [], []
    for detail in details:
        bags = detail.get("includedCheckedBags") or {}
        unit = (bags.get("weightUnit") or "").upper()
        kg = bags.get("weight") if unit in ("KG", "KGS") else None
        quantity = bags.get("quantity")
        counts.append(int(quantity) if quantity is not None else (1 if kg else 0))
        weights.append(int(kg) if kg else None)
    if not counts:
        return 0, None
    checked = min(counts)
    return checked, (min(weights) if checked and None not in weights else None)


def _fare_type(offer):
    kinds = set((offer.get("pricingOptions") or {}).get("fareType") or [])
    if kinds & PRIVATE_FARES:
        return "private"
    return "public" if "PUBLISHED" in kinds else "unknown"


def _expiry(offer):
    """The end of the last ticketing date, in the agency's time zone."""
    day = offer.get("lastTicketingDate")
    if not day:
        return None
    return datetime.combine(date.fromisoformat(day), time(23, 59), tzinfo=ZoneInfo(settings.TIME_ZONE))


def map_offer(offer, cabin):
    """A flight offer as a Result: its itineraries are the directions. Technical stops are ignored."""
    flights = []
    for direction, itinerary in zip(DIRECTIONS, offer.get("itineraries") or [], strict=False):
        for segment in itinerary.get("segments") or []:
            departure_date, departure_time = _local(segment["departure"].get("at"))
            arrival_date, arrival_time = _local(segment["arrival"].get("at"))
            marketing = segment.get("carrierCode")
            operating = (segment.get("operating") or {}).get("carrierCode")
            flights.append(
                ResultSegment(
                    direction=direction,
                    airline=marketing,
                    flight_number=str(segment.get("number") or ""),
                    operating_airline=operating if operating and operating != marketing else None,
                    origin=segment["departure"]["iataCode"],
                    destination=segment["arrival"]["iataCode"],
                    departure_date=departure_date,
                    departure_time=departure_time,
                    arrival_date=arrival_date,
                    arrival_time=arrival_time,
                )
            )
    price = offer.get("price") or {}
    travelers = offer.get("travelerPricings") or []
    if not (price.get("grandTotal") or price.get("total")) or not travelers:
        raise ProviderError("Amadeus sent a fare without pricing.")
    # One adult was asked for, so the first traveller pricing is theirs.
    details = travelers[0].get("fareDetailsBySegment") or []
    cabin_code = next((d.get("cabin") for d in details if d.get("cabin")), None)
    checked_bags, checked_bag_kg = _bags(details)
    seats = offer.get("numberOfBookableSeats")
    return Result(
        segments=flights,
        airline=(offer.get("validatingAirlineCodes") or [None])[0] or (flights[0].airline if flights else None),
        ticket_class=TICKET_CLASSES.get(cabin_code, cabin_code.lower()) if cabin_code else cabin,
        net_amount=_amount(price.get("grandTotal") or price.get("total")),
        net_currency=(price.get("currency") or "").upper(),
        checked_bags=checked_bags,
        checked_bag_kg=checked_bag_kg,
        cabin_bag_kg=None,
        # The search does not state fare conditions.
        refund_policy="not_allowed",
        change_policy="not_allowed",
        fare_type=_fare_type(offer),
        seats_left=seats if isinstance(seats, int) else None,
        provider_ref=str(offer.get("id")),
        expires_at=_expiry(offer),
    )
