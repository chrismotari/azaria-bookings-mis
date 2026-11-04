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
