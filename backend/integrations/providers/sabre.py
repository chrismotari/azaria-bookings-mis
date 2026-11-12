"""Sabre: Bargain Finder Max (REST, version 5) with its grouped itinerary response."""

import base64
from datetime import date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

import httpx
from django.conf import settings

from .base import Provider, ProviderError, Result, ResultSegment, SearchRequest

# The certification host for test mode, production for live.
HOSTS = {"test": "https://api.cert.platform.sabre.com", "live": "https://api.platform.sabre.com"}
TOKEN_PATH = "/v2/auth/token"
SEARCH_PATH = "/v5/offers/shop"
TIMEOUT_SECONDS = 60

# The httpx transport; None uses the network (tests put an httpx.MockTransport here).
transport = None

DIRECTIONS = ["outbound", "return"]
CABINS = {"economy": "Y", "premium_economy": "S", "business": "C", "first": "F"}
# Sabre's cabin codes, including premium first (P), premium business (J) and premium economy's W.
TICKET_CLASSES = {
    "Y": "economy",
    "S": "premium_economy",
    "W": "premium_economy",
    "C": "business",
    "J": "business",
    "F": "first",
    "P": "first",
}


def _b64(value):
    return base64.b64encode(value.encode()).decode()


class SabreProvider(Provider):
    credential_fields = ["user_id", "password", "pseudo_city_code", "domain"]

    def __init__(self, credentials, mode):
        super().__init__(credentials, mode)
        self._token = None

    def _post(self, path, **kwargs):
        try:
            with httpx.Client(base_url=HOSTS[self.mode], transport=transport, timeout=TIMEOUT_SECONDS) as client:
                response = client.post(path, **kwargs)
        except httpx.HTTPError as exc:
            raise ProviderError(f"Sabre could not be reached ({exc.__class__.__name__}).") from exc
        if response.status_code >= 400:
            raise ProviderError(error_message(response))
        try:
            return response.json()
        except ValueError as exc:
            raise ProviderError("Sabre sent an answer that could not be read.") from exc

    def token(self):
        """A bearer token, taken once per provider instance."""
        if self._token is None:
            c = self.credentials
            # Sabre's scheme: the client id and the password each base64-encoded, then the pair encoded again.
            client_id = f"V1:{c['user_id']}:{c['pseudo_city_code']}:{c['domain']}"
            secret = _b64(f"{_b64(client_id)}:{_b64(c['password'])}")
            data = self._post(
                TOKEN_PATH,
                data={"grant_type": "client_credentials"},
                headers={"Authorization": f"Basic {secret}"},
            )
            if not data.get("access_token"):
                raise ProviderError("Sabre sent no access token.")
            self._token = data["access_token"]
        return self._token

    def test(self):
        # Taking a token needs valid credentials and searches nothing.
        self.token()
        return "Connected to Sabre."

    def search(self, request: SearchRequest):
        data = self._post(
            SEARCH_PATH,
            json=search_body(request, self.credentials["pseudo_city_code"]),
            headers={"Authorization": f"Bearer {self.token()}", "Accept": "application/json"},
        )
        response = data.get("groupedItineraryResponse")
        if not isinstance(response, dict):
            raise ProviderError("Sabre sent an answer that could not be read.")
        return map_response(response, request.cabin)


def search_body(request, pseudo_city_code):
    """A Bargain Finder Max request for one adult in one cabin, with penalty information."""
    legs = [(request.origin, request.destination, request.departure_date)]
    if request.return_date:
        legs.append((request.destination, request.origin, request.return_date))
    preferences = {
        "CabinPref": [{"Cabin": CABINS[request.cabin], "PreferLevel": "Only"}],
        "TPA_Extensions": {"VoluntaryChanges": {"Match": "Info"}},
    }
    if request.max_connections is not None:
        preferences["MaxStopsQuantity"] = request.max_connections
    return {
        "OTA_AirLowFareSearchRQ": {
            "Version": "5",
            "POS": {
                "Source": [
                    {
                        "PseudoCityCode": pseudo_city_code,
                        "RequestorID": {"Type": "1", "ID": "1", "CompanyName": {"Code": "TN"}},
                    }
                ]
            },
            "OriginDestinationInformation": [
                {
                    "RPH": str(number),
                    "DepartureDateTime": f"{day.isoformat()}T00:00:00",
                    "OriginLocation": {"LocationCode": origin},
                    "DestinationLocation": {"LocationCode": destination},
                }
                for number, (origin, destination, day) in enumerate(legs, start=1)
            ],
            "TravelPreferences": preferences,
            "TravelerInfoSummary": {
                "SeatsRequested": [1],
                "AirTravelerAvail": [{"PassengerTypeQuantity": [{"Code": "ADT", "Quantity": 1}]}],
            },
            "TPA_Extensions": {"IntelliSellTransaction": {"RequestType": {"Name": "50ITINS"}}},
        }
    }


def error_message(response):
    try:
        data = response.json()
    except ValueError:
        data = {}
    detail = (data.get("message") or data.get("error_description")) if isinstance(data, dict) else None
    return f"Sabre error {response.status_code}: {detail}" if detail else f"Sabre error {response.status_code}."


def _time(value):
    """A schedule's local time; Sabre gives it with the airport's offset (e.g. "23:55:00+03:00"), which is dropped."""
    try:
        return time.fromisoformat(value[:8]).replace(second=0)
    except (TypeError, ValueError) as exc:
        raise ProviderError(f"Sabre sent an unreadable time ({value}).") from exc


def _amount(value):
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ProviderError(f"Sabre sent an unreadable price ({value}).") from exc


def _policy(penalties, kind, allowed):
    """A refund or change policy from the penalties before departure: none stated is not allowed; allowed with a
    zero amount is free, otherwise with a fee."""
    found = [p for p in penalties if p.get("type") == kind and p.get("applicability", "Before") == "Before"]
    if not found or not any(p.get(allowed) for p in found):
        return "not_allowed"
    amounts = [p.get("amount") for p in found if p.get(allowed)]
    return "free" if all(a is not None and _amount(a) == 0 for a in amounts) else "with_fee"


def _bags(passenger, allowances):
    """(checked bags, kilograms or None): the fewest across the checked allowances; a weight alone is one bag."""
    counts, weights = [], []
    for info in passenger.get("baggageInformation") or []:
        if info.get("provisionType") != "A":
            continue
        allowance = allowances.get((info.get("allowance") or {}).get("ref"), {})
        kg = allowance.get("weight") if (allowance.get("unit") or "").lower() in ("kg", "kilograms") else None
        pieces = allowance.get("pieceCount")
        counts.append(int(pieces) if pieces is not None else (1 if kg else 0))
        weights.append(int(kg) if kg else None)
    if not counts:
        return 0, None
    checked = min(counts)
    return checked, (min(weights) if checked and None not in weights else None)


def _expiry(fare):
    """The last ticketing date and time (the end of that day when no time is given), in the agency's time zone."""
    day = fare.get("lastTicketDate")
    if not day:
        return None
    at = time.fromisoformat(fare["lastTicketTime"]) if fare.get("lastTicketTime") else time(23, 59)
    return datetime.combine(date.fromisoformat(day), at, tzinfo=ZoneInfo(settings.TIME_ZONE))


def map_response(response, cabin):
    schedules = {s["id"]: s for s in response.get("scheduleDescs") or []}
    legs = {leg["id"]: leg for leg in response.get("legDescs") or []}
    allowances = {a["id"]: a for a in response.get("baggageAllowanceDescs") or []}
    results = []
    for group in response.get("itineraryGroups") or []:
        dates = [d["departureDate"] for d in (group.get("groupDescription") or {}).get("legDescriptions") or []]
        for itinerary in group.get("itineraries") or []:
            results.append(map_itinerary(itinerary, dates, legs, schedules, allowances, cabin))
    if not results:
        errors = [m.get("text") for m in response.get("messages") or [] if m.get("severity") == "Error"]
        if errors:
            raise ProviderError(f"Sabre error: {errors[0]}")
    return results


def map_itinerary(itinerary, dates, legs, schedules, allowances, cabin):
    """An itinerary as a Result: its legs are the directions. Technical stops are ignored."""
    flights = []
    for direction, leg_ref, day in zip(DIRECTIONS, itinerary.get("legs") or [], dates, strict=False):
        leg = legs.get(leg_ref.get("ref"))
        if leg is None:
            raise ProviderError("Sabre sent a fare with an unknown flight.")
        leg_date = date.fromisoformat(day)
        for schedule_ref in leg.get("schedules") or []:
            schedule = schedules.get(schedule_ref.get("ref"))
            if schedule is None:
                raise ProviderError("Sabre sent a fare with an unknown flight.")
            departure_date = leg_date + timedelta(days=schedule_ref.get("departureDateAdjustment") or 0)
            arrival = schedule["arrival"]
            carrier = schedule.get("carrier") or {}
            marketing, operating = carrier.get("marketing"), carrier.get("operating")
            flights.append(
                ResultSegment(
                    direction=direction,
                    airline=marketing,
                    flight_number=str(carrier.get("marketingFlightNumber") or ""),
                    operating_airline=operating if operating and operating != marketing else None,
                    origin=schedule["departure"]["airport"],
                    destination=arrival["airport"],
                    departure_date=departure_date,
                    departure_time=_time(schedule["departure"].get("time")),
                    arrival_date=departure_date + timedelta(days=arrival.get("dateAdjustment") or 0),
                    arrival_time=_time(arrival.get("time")),
                )
            )
    pricing = (itinerary.get("pricingInformation") or [{}])[0]
    fare = pricing.get("fare") or {}
    passengers = fare.get("passengerInfoList") or []
    if not fare.get("totalFare") or not passengers:
        raise ProviderError("Sabre sent a fare without pricing.")
    # One adult was asked for, so the first passenger is theirs.
    passenger = passengers[0].get("passengerInfo") or {}
    booked = [
        segment.get("segment") or {}
        for component in passenger.get("fareComponents") or []
        for segment in component.get("segments") or []
    ]
    cabin_code = next((s.get("cabinCode") for s in booked if s.get("cabinCode")), None)
    seats = [s["seatsAvailable"] for s in booked if isinstance(s.get("seatsAvailable"), int)]
    penalties = (passenger.get("penaltiesInfo") or {}).get("penalties") or []
    checked_bags, checked_bag_kg = _bags(passenger, allowances)
    return Result(
        segments=flights,
        airline=fare.get("validatingCarrierCode") or (flights[0].airline if flights else None),
        ticket_class=TICKET_CLASSES.get(cabin_code, cabin),
        net_amount=_amount(fare["totalFare"].get("totalPrice")),
        net_currency=(fare["totalFare"].get("currency") or "").upper(),
        checked_bags=checked_bags,
        checked_bag_kg=checked_bag_kg,
        cabin_bag_kg=None,
        refund_policy=_policy(penalties, "Refund", "refundable"),
        change_policy=_policy(penalties, "Exchange", "changeable"),
        fare_type="unknown",
        seats_left=min(seats) if seats else None,
        provider_ref=str(itinerary.get("id")),
        expires_at=_expiry(fare),
    )
