"""Itineraries as lists of segment dicts (Segment.FIELDS, airlines and airports as model instances).

Validated input and stored rows (Segment.as_data) share this shape, so the same rules and derivations serve both.
"""

from datetime import datetime

from .models import Segment, Trip

Direction = Segment.Direction


def by_direction(segments):
    """{direction: its segments in flight order} for every direction."""
    return {direction: [s for s in segments if s["direction"] == direction] for direction in Direction.values}


def departs(segment):
    return datetime.combine(segment["departure_date"], segment["departure_time"])


def arrives(segment):
    return datetime.combine(segment["arrival_date"], segment["arrival_time"])


def airlines_in(segments):
    """Ids of every marketing and operating airline the segments name."""
    return {s[f].pk for s in segments for f in ("airline", "operating_airline") if s[f] is not None}


def connections(flights):
    """The connections between consecutive flights of one direction: airport, wait_minutes and kind.

    Both times are local to the connection airport, so their difference is the wait.
    """
    found = []
    for previous, following in zip(flights, flights[1:], strict=False):
        minutes = int((departs(following) - arrives(previous)).total_seconds() // 60)
        kind = "stopover" if minutes >= Segment.STOPOVER_MINUTES else "layover"
        found.append({"airport": previous["destination"], "wait_minutes": minutes, "kind": kind})
    return found


def derived_fields(segments):
    """The offer's origin, destination, departure_date and return_date, from valid segments."""
    flights = by_direction(segments)
    outbound, inbound = flights[Direction.OUTBOUND], flights[Direction.RETURN]
    return {
        "origin": outbound[0]["origin"],
        "destination": outbound[-1]["destination"],
        "departure_date": outbound[0]["departure_date"],
        "return_date": inbound[0]["departure_date"] if inbound else None,
    }


def _direction_errors(label, flights, kept_airlines):
    if len(flights) > Segment.MAX_PER_DIRECTION:
        return [f"{label}: at most {Segment.MAX_PER_DIRECTION} flights ({Segment.MAX_PER_DIRECTION - 1} connections)."]
    errors = []
    for number, flight in enumerate(flights, start=1):
        prefix = f"{label} flight {number}"
        if flight["origin"] == flight["destination"]:
            errors.append(f"{prefix}: From and To must differ.")
        days = (flight["arrival_date"] - flight["departure_date"]).days
        if not -1 <= days <= 2:
            errors.append(
                f"{prefix}: the arrival date must be between one day before and two days after the departure."
            )
        for airline in (flight["airline"], flight.get("operating_airline")):
            if airline is not None and not airline.is_active and airline.pk not in kept_airlines:
                errors.append(f"{prefix}: {airline.name} is no longer active.")
        if number > 1:
            previous = flights[number - 2]
            if flight["origin"] != previous["destination"]:
                errors.append(
                    f"{prefix}: must leave from {previous['destination'].code}, where flight {number - 1} arrives."
                )
            elif departs(flight) <= arrives(previous):
                errors.append(f"{prefix}: must leave after flight {number - 1} arrives.")
    return errors


def itinerary_errors(trip_type, segments, kept_airlines=(), route=None):
    """Messages for an itinerary that breaks the rules; empty when it is valid.

    kept_airlines: ids of inactive airlines the itinerary may keep because it already uses them.
    route: (origin, destination) the outbound flights must start and end at, when fixed.
    """
    flights = by_direction(segments)
    outbound, inbound = flights[Direction.OUTBOUND], flights[Direction.RETURN]
    errors = []
    if not outbound:
        errors.append("Add the outbound flights.")
    if trip_type == Trip.TripType.ONE_WAY and inbound:
        errors.append("A one-way trip has no return flights.")
    if trip_type == Trip.TripType.RETURN and not inbound:
        errors.append("Add the return flights.")
    errors += _direction_errors("Outbound", outbound, kept_airlines)
    errors += _direction_errors("Return", inbound, kept_airlines)
    if errors or not outbound:
        return errors

    origin, destination = outbound[0]["origin"], outbound[-1]["destination"]
    if route is not None:
        if origin != route[0]:
            errors.append(f"Outbound flight 1: must leave from {route[0].code}.")
        if destination != route[1]:
            errors.append(f"Outbound flight {len(outbound)}: must arrive at {route[1].code}.")
    elif origin == destination:
        errors.append("The outbound flights must end somewhere other than where they start.")
    if inbound and trip_type == Trip.TripType.RETURN:
        if inbound[0]["origin"] != destination:
            errors.append(f"Return flight 1: must leave from {destination.code}, where the outbound flights arrive.")
        if inbound[-1]["destination"] != origin:
            errors.append(
                f"Return flight {len(inbound)}: must arrive at {origin.code}, where the outbound flights start."
            )
        if departs(inbound[0]) <= arrives(outbound[-1]):
            errors.append("Return flight 1: must leave after the outbound flights arrive.")
    return errors


def _day(value):
    return f"{value:%a}, {value.day} {value:%b %Y}"


def change_lines(segments):
    """Segments as readable dicts (direction, flight, route, departure, arrival), as recorded in Booking.changes."""
    return [
        {
            "direction": s["direction"],
            "flight": f"{s['airline'].iata_code} {s['flight_number']}",
            "route": f"{s['origin'].code} → {s['destination'].code}",
            "departure": f"{_day(s['departure_date'])} {s['departure_time']:%H:%M}",
            "arrival": (
                f"{s['arrival_time']:%H:%M}"
                if s["arrival_date"] == s["departure_date"]
                else f"{_day(s['arrival_date'])} {s['arrival_time']:%H:%M}"
            ),
        }
        for s in segments
    ]


def same_itinerary(first, second):
    """Whether two segment lists describe the same flights."""

    def key(segments):
        return [tuple(getattr(s[f], "pk", s[f]) for f in Segment.FIELDS) for s in segments]

    return key(first) == key(second)
