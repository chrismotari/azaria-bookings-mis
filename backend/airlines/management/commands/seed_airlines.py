import csv
import re

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction

from airlines.models import Airline

SOURCE = settings.BASE_DIR / "data" / "raw" / "airlines.dat"
IATA = re.compile(r"^[A-Z0-9]{2}$")
ICAO = re.compile(r"^[A-Z]{3}$")


def clean(value):
    """OpenFlights writes empty values as \\N."""
    return "" if value in ("\\N", "-", "N/A") else value.strip()


def candidates():
    """Active rows with a two-character IATA code, one per code: the one with an ICAO code, else the first."""
    chosen = {}
    with open(SOURCE, encoding="utf-8", newline="") as f:
        for row in csv.reader(f):
            _id, name, _alias, iata, icao, _callsign, country, active = row[:8]
            iata, icao, name = clean(iata), clean(icao), clean(name)
            if active != "Y" or not IATA.match(iata) or not name:
                continue
            current = chosen.get(iata)
            if current is None or (not current["icao_code"] and ICAO.match(icao)):
                chosen[iata] = {
                    "iata_code": iata,
                    "icao_code": icao if ICAO.match(icao) else "",
                    "name": name,
                    "country": clean(country),
                }
    return chosen.values()


class Command(BaseCommand):
    help = "Add missing airlines from data/raw/airlines.dat (OpenFlights). Existing airlines are never changed."

    def handle(self, *args, **options):
        existing = set(Airline.objects.values_list("iata_code", flat=True))
        new = [Airline(**data) for data in candidates() if data["iata_code"] not in existing]
        with transaction.atomic():
            Airline.objects.bulk_create(new)
        self.stdout.write(self.style.SUCCESS(f"{len(new)} airline(s) added, {len(existing)} already present."))
