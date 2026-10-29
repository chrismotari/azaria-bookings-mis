import pytest
from django.core.management import call_command

from catalog.models import Airport

pytestmark = pytest.mark.django_db


@pytest.fixture
def airports():
    Airport.objects.bulk_create(
        [
            Airport(code="NBO", name="Jomo Kenyatta International Airport", city="Nairobi", country="Kenya"),
            Airport(code="WIL", name="Nairobi Wilson Airport", city="Nairobi", country="Kenya"),
            Airport(code="MBA", name="Moi International Airport", city="Mombasa", country="Kenya"),
            Airport(code="LHR", name="London Heathrow Airport", city="London", country="United Kingdom"),
            Airport(code="ANB", name="Anniston Regional Airport", city="Anniston", country="United States"),
        ]
    )


def codes(response):
    return [a["code"] for a in response.data]


def test_guest_can_search_airports(api, airports):
    response = api.get("/api/airports", {"search": "nairobi"})
    assert response.status_code == 200
    assert codes(response) == ["NBO", "WIL"]
    assert set(response.data[0]) == {"id", "code", "name", "city", "country"}


def test_search_matches_country_and_name(api, airports):
    assert codes(api.get("/api/airports", {"search": "kingdom"})) == ["LHR"]
    assert codes(api.get("/api/airports", {"search": "heathrow"})) == ["LHR"]


def test_exact_code_match_first(api, airports):
    # "nb" matches ANB and NBO by code; "nbo" exactly matches NBO only by code.
    assert codes(api.get("/api/airports", {"search": "NBO"}))[0] == "NBO"
    Airport.objects.create(code="NBX", name="Somewhere NBO Field", city="X", country="Y")
    assert codes(api.get("/api/airports", {"search": "nbo"})) == ["NBO", "NBX"]


def test_search_limited_to_20(api):
    Airport.objects.bulk_create(
        [Airport(code=f"Q{i:02d}", name=f"Test {i}", city="Testville", country="Testland") for i in range(30)]
    )
    assert len(api.get("/api/airports", {"search": "testville"}).data) == 20


def test_empty_search_returns_nothing(api, airports):
    assert api.get("/api/airports").data == []


def test_airports_are_read_only(api, admin_api):
    assert api.post("/api/airports", {"code": "XXX"}, format="json").status_code == 405
    assert admin_api.post("/api/airports", {"code": "XXX"}, format="json").status_code == 405


def test_seed_airports_from_raw_csv():
    call_command("seed_airports")
    count = Airport.objects.count()
    assert count > 3000
    nbo = Airport.objects.get(code="NBO")
    assert nbo.city == "Nairobi"
    assert nbo.country == "Kenya"
    assert all(len(code) == 3 for code in Airport.objects.values_list("code", flat=True))

    Airport.objects.filter(code="NBO").update(city="Changed")
    call_command("seed_airports")
    assert Airport.objects.count() == count
    assert Airport.objects.get(code="NBO").city == "Nairobi"
