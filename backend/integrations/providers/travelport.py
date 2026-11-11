"""Travelport Universal API (uAPI): low-fare searches over its XML/SOAP Air service, Air schema v52."""

import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from xml.etree import ElementTree

import httpx

from .base import Provider, ProviderError, Result, ResultSegment, SearchRequest

# Travelport's EMEA gateways: pre-production (copy) for test mode, production for live.
ENDPOINTS = {
    "test": "https://emea.universal-api.pp.travelport.com/B2BGateway/connect/uAPI/",
    "live": "https://emea.universal-api.travelport.com/B2BGateway/connect/uAPI/",
}
SOAP = "http://schemas.xmlsoap.org/soap/envelope/"
AIR = "http://www.travelport.com/schema/air_v52_0"
COMMON = "http://www.travelport.com/schema/common_v52_0"
SYSTEM = "http://www.travelport.com/schema/system_v32_0"
SYSTEM_COMMON = "http://www.travelport.com/schema/common_v32_0"
# Travelport's Galileo host, the one trial accounts are given.
HOST = "1G"
TIMEOUT_SECONDS = 60

# The httpx transport; None uses the network (tests put an httpx.MockTransport here).
transport = None

DIRECTIONS = ["outbound", "return"]
CABINS = {"economy": "Economy", "premium_economy": "PremiumEconomy", "business": "Business", "first": "First"}
TICKET_CLASSES = {value: key for key, value in CABINS.items()}
# A uAPI money value: the currency code followed by the amount, e.g. "GBP455.50".
MONEY = re.compile(r"^([A-Z]{3})(-?\d+(?:\.\d+)?)$")

for prefix, uri in (("soapenv", SOAP), ("air", AIR), ("com", COMMON), ("sys", SYSTEM)):
    ElementTree.register_namespace(prefix, uri)


def _add(parent, namespace, tag, text=None, **attrs):
    element = ElementTree.SubElement(parent, f"{{{namespace}}}{tag}", attrs)
    element.text = text
    return element


def _envelope(request):
    envelope = ElementTree.Element(f"{{{SOAP}}}Envelope")
    ElementTree.SubElement(envelope, f"{{{SOAP}}}Body").append(request)
    return ElementTree.tostring(envelope, encoding="utf-8", xml_declaration=True)


def _parse(content):
    """The answer's root with namespaces removed from tags, or None when it is not XML."""
    try:
        root = ElementTree.fromstring(content)
    except ElementTree.ParseError:
        return None
    for element in root.iter():
        element.tag = element.tag.rpartition("}")[2]
    return root


class TravelportProvider(Provider):
    credential_fields = ["username", "password", "target_branch"]

    def _call(self, service, request):
        """Posts a request to a uAPI service and returns the body's answer element."""
        try:
            with httpx.Client(
                transport=transport,
                timeout=TIMEOUT_SECONDS,
                # Travelport's convention: the user name is prefixed with "Universal API/".
                auth=(f"Universal API/{self.credentials['username']}", self.credentials["password"]),
            ) as client:
                response = client.post(
                    ENDPOINTS[self.mode] + service,
                    content=_envelope(request),
                    headers={"Content-Type": "text/xml; charset=utf-8", "Accept": "text/xml", "SOAPAction": ""},
                )
        except httpx.HTTPError as exc:
            raise ProviderError(f"Travelport could not be reached ({exc.__class__.__name__}).") from exc
        root = _parse(response.content)
        fault = root.find("Body/Fault") if root is not None else None
        if fault is not None:
            raise ProviderError(fault_message(fault))
        if response.status_code == 401:
            raise ProviderError("Travelport error 401: the username or password was not accepted.")
        if response.status_code >= 400:
            raise ProviderError(f"Travelport error {response.status_code}.")
        answer = root.find("Body/*") if root is not None else None
        if answer is None:
            raise ProviderError("Travelport sent an answer that could not be read.")
        return answer

    def test(self):
        # A ping needs valid credentials and searches nothing.
        request = ElementTree.Element(
            f"{{{SYSTEM}}}PingReq", {"TraceId": uuid.uuid4().hex, "TargetBranch": self.credentials["target_branch"]}
        )
        _add(request, SYSTEM_COMMON, "BillingPointOfSaleInfo", OriginApplication="UAPI")
        _add(request, SYSTEM, "Payload", "Azaria Bookings connection test")
        self._call("SystemService", request)
        return "Connected to Travelport."

    def search(self, request: SearchRequest):
        answer = self._call("AirService", search_request(request, self.credentials["target_branch"]))
        if answer.tag != "LowFareSearchRsp":
            raise ProviderError("Travelport sent an answer that could not be read.")
        return map_response(answer, request.cabin)


def search_request(request, target_branch):
    """A LowFareSearchReq for one adult, asking for priced solutions (one per itinerary)."""
    search = ElementTree.Element(
        f"{{{AIR}}}LowFareSearchReq",
        {"TraceId": uuid.uuid4().hex, "TargetBranch": target_branch, "SolutionResult": "true"},
    )
    _add(search, COMMON, "BillingPointOfSaleInfo", OriginApplication="UAPI")
    legs = [(request.origin, request.destination, request.departure_date)]
    if request.return_date:
        legs.append((request.destination, request.origin, request.return_date))
    for origin, destination, day in legs:
        leg = _add(search, AIR, "SearchAirLeg")
        _add(_add(leg, AIR, "SearchOrigin"), COMMON, "Airport", Code=origin)
        _add(_add(leg, AIR, "SearchDestination"), COMMON, "Airport", Code=destination)
        _add(leg, AIR, "SearchDepTime", PreferredTime=day.isoformat())
        modifiers = _add(leg, AIR, "AirLegModifiers")
        _add(_add(modifiers, AIR, "PermittedCabins"), COMMON, "CabinClass", Type=CABINS[request.cabin])
        if request.max_connections is not None:
            _add(modifiers, AIR, "FlightType", MaxConnections=str(request.max_connections))
    modifiers = _add(search, AIR, "AirSearchModifiers")
    _add(_add(modifiers, AIR, "PreferredProviders"), COMMON, "Provider", Code=HOST)
    _add(search, COMMON, "SearchPassenger", Code="ADT")
    return search


def fault_message(fault):
    detail = fault.findtext("detail/ErrorInfo/Description") or fault.findtext("faultstring")
    return f"Travelport error: {detail.strip()}" if detail and detail.strip() else "Travelport error."


def _money(value):
    """(currency, amount) from a uAPI money value such as "GBP455.50"."""
    match = MONEY.match((value or "").strip())
    if not match:
        raise ProviderError(f"Travelport sent an unreadable price ({value}).")
    return match.group(1), Decimal(match.group(2))


def _local(value):
    """A local date and time; uAPI gives them with the airport's offset, which is dropped."""
    moment = datetime.fromisoformat(value)
    return moment.date(), moment.time().replace(second=0, microsecond=0)


def _policy(pricing, allowed, penalty_tag):
    """A refund or change policy: not allowed unless the fare says it is; a penalty of zero is free, any other
    (or an unstated one) a fee."""
    if (pricing.get(allowed) or "").lower() != "true":
        return "not_allowed"
    penalty = pricing.find(penalty_tag)
    if penalty is None:
        return "with_fee"
    amount, percentage = penalty.findtext("Amount"), penalty.findtext("Percentage")
    try:
        value = _money(amount)[1] if amount else Decimal(percentage) if percentage else None
    except (InvalidOperation, ProviderError):
        value = None
    return "free" if value == 0 else "with_fee"


def _allowance(fare):
    """(checked pieces, kilograms or None) of a fare component; a weight alone counts as one bag."""
    allowance = fare.find("BaggageAllowance") if fare is not None else None
    if allowance is None:
        return 0, None
    weight = allowance.find("MaxWeight")
    kg = None
    if weight is not None and (weight.get("Unit") or "").lower().startswith("kilogram") and weight.get("Value"):
        kg = int(Decimal(weight.get("Value"))) or None
    pieces = allowance.findtext("NumberOfPieces")
    count = int(pieces) if pieces and pieces.strip().isdigit() else (1 if kg else 0)
    return count, kg if count else None


def _fare_type(fares):
    private = any(f.get("PrivateFare") or (f.get("NegotiatedFare") or "").lower() == "true" for f in fares)
    return "private" if private else "public"


def map_response(response, cabin):
    segments = {segment.get("Key"): segment for segment in response.iterfind("AirSegmentList/AirSegment")}
    fares = {fare.get("Key"): fare for fare in response.iterfind("FareInfoList/FareInfo")}
    return [map_solution(solution, segments, fares, cabin) for solution in response.iterfind("AirPricingSolution")]


def map_solution(solution, segments, fares, cabin):
    """An AirPricingSolution as a Result: its journeys are the directions. Technical stops are ignored."""
    flights = []
    for direction, journey in zip(DIRECTIONS, solution.findall("Journey")):
        for ref in journey.findall("AirSegmentRef"):
            segment = segments.get(ref.get("Key"))
            if segment is None:
                raise ProviderError("Travelport sent a fare with an unknown flight.")
            departure_date, departure_time = _local(segment.get("DepartureTime"))
            arrival_date, arrival_time = _local(segment.get("ArrivalTime"))
            marketing = segment.get("Carrier")
            codeshare = segment.find("CodeshareInfo")
            operating = codeshare.get("OperatingCarrier") if codeshare is not None else None
            flights.append(
                ResultSegment(
                    direction=direction,
                    airline=marketing,
                    flight_number=segment.get("FlightNumber") or "",
                    operating_airline=operating if operating and operating != marketing else None,
                    origin=segment.get("Origin"),
                    destination=segment.get("Destination"),
                    departure_date=departure_date,
                    departure_time=departure_time,
                    arrival_date=arrival_date,
                    arrival_time=arrival_time,
                )
            )
    # The solution is for one adult, so its first pricing is theirs.
    pricing = solution.find("AirPricingInfo")
    if pricing is None:
        raise ProviderError("Travelport sent a fare without pricing.")
    used = [fares[ref.get("Key")] for ref in pricing.findall("FareInfoRef") if ref.get("Key") in fares]
    allowances = [_allowance(fare) for fare in used] or [(0, None)]
    checked_bags = min(count for count, _ in allowances)
    weights = [kg for _, kg in allowances]
    bookings = pricing.findall("BookingInfo")
    cabin_class = bookings[0].get("CabinClass") if bookings else None
    counts = [int(b.get("BookingCount")) for b in bookings if (b.get("BookingCount") or "").isdigit()]
    currency, amount = _money(solution.get("TotalPrice") or pricing.get("TotalPrice"))
    ticketing = solution.get("LatestTicketingTime") or pricing.get("LatestTicketingTime")
    expires_at = datetime.fromisoformat(ticketing) if ticketing else None
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return Result(
        segments=flights,
        airline=pricing.get("PlatingCarrier") or (flights[0].airline if flights else None),
        ticket_class=TICKET_CLASSES.get(cabin_class, cabin_class.lower()) if cabin_class else cabin,
        net_amount=amount,
        net_currency=currency,
        checked_bags=checked_bags,
        checked_bag_kg=min(weights) if checked_bags and None not in weights else None,
        cabin_bag_kg=None,
        refund_policy=_policy(pricing, "Refundable", "CancelPenalty"),
        change_policy=_policy(pricing, "Exchangeable", "ChangePenalty"),
        fare_type=_fare_type(used),
        seats_left=min(counts) if counts else None,
        provider_ref=solution.get("Key"),
        expires_at=expires_at,
    )
