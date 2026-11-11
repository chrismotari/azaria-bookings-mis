"""What every fare provider implements, and the normalised shapes they speak."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal


class ProviderError(Exception):
    """A search or connection test failed at the provider; the message is short and safe to show."""


@dataclass(frozen=True)
class SearchRequest:
    """One adult, one departure date (and the return date for a return trip)."""

    origin: str
    destination: str
    departure_date: date
    return_date: date | None
    cabin: str
    # Per direction; None for any.
    max_connections: int | None


@dataclass
class ResultSegment:
    """A flight as the provider gave it: carriers and airports by IATA code, local dates and times."""

    direction: str
    airline: str
    flight_number: str
    operating_airline: str | None
    origin: str
    destination: str
    departure_date: date
    departure_time: time
    arrival_date: date
    arrival_time: time


@dataclass
class Result:
    """One fare found, normalised to the itinerary shape of offers."""

    segments: list[ResultSegment]
    # The ticketing airline's IATA code.
    airline: str
    ticket_class: str
    net_amount: Decimal
    net_currency: str
    checked_bags: int
    checked_bag_kg: int | None
    cabin_bag_kg: int | None
    refund_policy: str
    change_policy: str
    fare_type: str
    seats_left: int | None
    provider_ref: str
    expires_at: datetime | None


class Provider(ABC):
    """A fare provider: search(request) -> results, and a connection test."""

    # The credentials an integration of this provider holds, e.g. ["access_token"].
    credential_fields: list[str] = []

    def __init__(self, credentials, mode):
        self.credentials = credentials
        self.mode = mode

    @abstractmethod
    def search(self, request: SearchRequest) -> list[Result]:
        """The fares found; raises ProviderError when the search fails."""

    @abstractmethod
    def test(self) -> str:
        """A short success message; raises ProviderError when the credentials do not work."""
