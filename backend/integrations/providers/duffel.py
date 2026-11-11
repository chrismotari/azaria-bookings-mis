"""Duffel (duffel.com): offer requests over its REST API, version v2."""

from datetime import datetime
from decimal import Decimal

import httpx

from .base import Provider, ProviderError, Result, ResultSegment, SearchRequest

BASE_URL = "https://api.duffel.com"
API_VERSION = "v2"
# Duffel waits this long for each airline (milliseconds); our own timeout is longer.
SUPPLIER_TIMEOUT_MS = 20000
TIMEOUT_SECONDS = 60

# The httpx transport; None uses the network (tests put an httpx.MockTransport here).
transport = None

DIRECTIONS = ["outbound", "return"]


class DuffelProvider(Provider):
    credential_fields = ["access_token"]

    def _client(self):
        return httpx.Client(
            base_url=BASE_URL,
            transport=transport,
            timeout=TIMEOUT_SECONDS,
            headers={
                "Authorization": f"Bearer {self.credentials['access_token']}",
                "Duffel-Version": API_VERSION,
                "Accept": "application/json",
            },
        )

    def _call(self, method, path, **kwargs):
        try:
            with self._client() as client:
                response = client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise ProviderError(f"Duffel could not be reached ({exc.__class__.__name__}).") from exc
        if response.status_code >= 400:
            raise ProviderError(error_message(response))
        return response.json()

    def test(self):
        # Listing one airline is cheap and needs a valid token.
        self._call("GET", "/air/airlines", params={"limit": 1})
        return "Connected to Duffel."

    def search(self, request: SearchRequest):
        slices = [
            {
                "origin": request.origin,
                "destination": request.destination,
                "departure_date": request.departure_date.isoformat(),
            }
        ]
        if request.return_date:
            slices.append(
                {
                    "origin": request.destination,
                    "destination": request.origin,
                    "departure_date": request.return_date.isoformat(),
                }
            )
        body = {"slices": slices, "passengers": [{"type": "adult"}], "cabin_class": request.cabin}
        if request.max_connections is not None:
            body["max_connections"] = request.max_connections
        data = self._call(
            "POST",
            "/air/offer_requests",
            params={"return_offers": "true", "supplier_timeout": SUPPLIER_TIMEOUT_MS},
            json={"data": body},
        )
        return [map_offer(offer, request.cabin) for offer in data["data"].get("offers", [])]


def error_message(response):
    try:
        errors = response.json().get("errors") or []
    except ValueError:
        errors = []
    detail = errors[0].get("message") or errors[0].get("title") if errors else None
    return f"Duffel error {response.status_code}: {detail}" if detail else f"Duffel error {response.status_code}."


def _local(value):
    """A segment's local date and time; Duffel gives them without an offset."""
    moment = datetime.fromisoformat(value)
    return moment.date(), moment.time().replace(second=0, microsecond=0)


def _carrier(carrier):
    return (carrier or {}).get("iata_code")


def _policy(condition):
    """Duffel's refund or change condition as a policy; unknown conditions count as not allowed."""
    if not condition or not condition.get("allowed"):
        return "not_allowed"
    penalty = condition.get("penalty_amount")
    # A penalty Duffel does not state is assumed to exist.
    return "free" if penalty is not None and Decimal(penalty) == 0 else "with_fee"


def _checked_bags(segments):
    """Checked bags included on every flight: the fewest any segment allows (the first passenger's)."""
    counts = []
    for segment in segments:
        passengers = segment.get("passengers") or [{}]
        bags = passengers[0].get("baggages") or []
        counts.append(sum(bag.get("quantity", 0) for bag in bags if bag.get("type") == "checked"))
    return min(counts) if counts else 0


def _fare_type(offer):
    if "private_fares" not in offer:
        return "unknown"
    return "private" if offer["private_fares"] else "public"


def map_offer(offer, cabin):
    """A Duffel offer as a Result. Technical stops inside a segment are ignored."""
    segments = []
    duffel_segments = []
    for direction, piece in zip(DIRECTIONS, offer["slices"], strict=False):
        for segment in piece["segments"]:
            duffel_segments.append(segment)
            departure_date, departure_time = _local(segment["departing_at"])
            arrival_date, arrival_time = _local(segment["arriving_at"])
            marketing = _carrier(segment.get("marketing_carrier"))
            operating = _carrier(segment.get("operating_carrier"))
            segments.append(
                ResultSegment(
                    direction=direction,
                    airline=marketing,
                    flight_number=str(segment.get("marketing_carrier_flight_number") or ""),
                    operating_airline=operating if operating and operating != marketing else None,
                    origin=segment["origin"]["iata_code"],
                    destination=segment["destination"]["iata_code"],
                    departure_date=departure_date,
                    departure_time=departure_time,
                    arrival_date=arrival_date,
                    arrival_time=arrival_time,
                )
            )
    first_passenger = (duffel_segments[0].get("passengers") or [{}])[0] if duffel_segments else {}
    conditions = offer.get("conditions") or {}
    expires_at = offer.get("expires_at")
    return Result(
        segments=segments,
        airline=_carrier(offer.get("owner")) or (segments[0].airline if segments else None),
        ticket_class=first_passenger.get("cabin_class") or cabin,
        net_amount=Decimal(offer["total_amount"]),
        net_currency=offer["total_currency"].upper(),
        checked_bags=_checked_bags(duffel_segments),
        checked_bag_kg=None,
        cabin_bag_kg=None,
        refund_policy=_policy(conditions.get("refund_before_departure")),
        change_policy=_policy(conditions.get("change_before_departure")),
        fare_type=_fare_type(offer),
        seats_left=None,
        provider_ref=offer["id"],
        expires_at=datetime.fromisoformat(expires_at.replace("Z", "+00:00")) if expires_at else None,
    )
