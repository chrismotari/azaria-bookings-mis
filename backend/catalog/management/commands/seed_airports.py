import csv

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction

from catalog.models import Airport

RAW_DIR = settings.BASE_DIR / "data" / "raw"


class Command(BaseCommand):
    help = "Create or update airports from the OurAirports CSV files in data/raw/."

    def handle(self, *args, **options):
        with open(RAW_DIR / "countries.csv", encoding="utf-8", newline="") as f:
            countries = {row["code"]: row["name"] for row in csv.DictReader(f)}

        created = updated = 0
        with open(RAW_DIR / "airports.csv", encoding="utf-8", newline="") as f, transaction.atomic():
            for row in csv.DictReader(f):
                code = row["iata_code"].strip().upper()
                if not code or row["scheduled_service"] != "yes" or row["type"] == "closed":
                    continue
                name = row["name"].strip()
                _, was_created = Airport.objects.update_or_create(
                    code=code,
                    defaults={
                        "name": name,
                        "city": row["municipality"].strip() or name,
                        "country": countries.get(row["iso_country"], row["iso_country"]),
                    },
                )
                if was_created:
                    created += 1
                else:
                    updated += 1

        self.stdout.write(self.style.SUCCESS(f"Airports: {created} created, {updated} updated."))
