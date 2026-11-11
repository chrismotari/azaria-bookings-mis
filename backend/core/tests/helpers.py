# The agencies conftest.py creates for the test session. The test client's default host reaches the first.
TEST_SCHEMA = "test"
TEST_DOMAIN = "testserver"
OTHER_SCHEMA = "other"
OTHER_DOMAIN = "other.localhost"

_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"


def airline_named(name="Kenya Airways"):
    """The airline with this name, created (with a free IATA code) if there is none yet."""
    from airlines.models import Airline

    found = Airline.objects.filter(name=name).first()
    if found:
        return found
    used = set(Airline.objects.values_list("iata_code", flat=True))
    code = next(a + b for a in _CODE_CHARS for b in _CODE_CHARS if a + b not in used)
    return Airline.objects.create(iata_code=code, name=name)


def html_part(email):
    """The email's single HTML alternative, checking that it also has a plain-text body."""
    assert email.body
    [(html, mimetype)] = email.alternatives
    assert mimetype == "text/html"
    return html


def flight(direction, airline, number, origin, destination, departs, arrives, operating=None):
    """A segment as the API takes it. departs, arrives: (date, "HH:MM") in local time."""
    return {
        "direction": direction,
        "airline": str(airline.id),
        "flight_number": number,
        "operating_airline": str(operating.id) if operating else None,
        "origin": origin,
        "destination": destination,
        "departure_date": departs[0].isoformat(),
        "departure_time": departs[1],
        "arrival_date": arrives[0].isoformat(),
        "arrival_time": arrives[1],
    }


def direct_flight(offer):
    """The offer's route as one flight on its departure date, as Offer.set_segments takes it."""
    from datetime import time

    return {
        "direction": "outbound",
        "airline": offer.airline,
        "flight_number": "100",
        "operating_airline": None,
        "origin": offer.origin,
        "destination": offer.destination,
        "departure_date": offer.departure_date,
        "departure_time": time(10, 0),
        "arrival_date": offer.departure_date,
        "arrival_time": time(18, 0),
    }


def direct(origin, destination, departure_date, airline=None):
    """One flight origin → destination (IATA codes) on departure_date (a date or ISO string), as the API takes it."""
    from datetime import date

    if isinstance(departure_date, str):
        departure_date = date.fromisoformat(departure_date)
    when = (departure_date, "10:00"), (departure_date, "18:00")
    return [flight("outbound", airline or airline_named(), "100", origin, destination, *when)]
