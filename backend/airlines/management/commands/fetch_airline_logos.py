import httpx
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand

from airlines.models import Airline, validate_logo

SOURCE = "https://pics.avs.io/al_square/200/200/{code}.png"
TIMEOUT_SECONDS = 10

# The httpx transport; None uses the network (tests put an httpx.MockTransport here).
transport = None


class Command(BaseCommand):
    help = "Download missing airline logos (Travelpayouts square images). Existing logos are never replaced."

    def add_arguments(self, parser):
        parser.add_argument("--codes", help="Only these IATA codes, comma-separated, e.g. KQ,EK.")

    def handle(self, *args, **options):
        airlines = Airline.objects.filter(is_active=True, logo="").order_by("iata_code")
        if options["codes"]:
            codes = [code.strip().upper() for code in options["codes"].split(",") if code.strip()]
            airlines = airlines.filter(iata_code__in=codes)
        saved, not_found, failed = [], [], []
        with httpx.Client(transport=transport, timeout=TIMEOUT_SECONDS, follow_redirects=True) as client:
            for airline in airlines:
                outcome = fetch(client, airline)
                {"saved": saved, "not_found": not_found, "failed": failed}[outcome].append(airline.iata_code)
        self.stdout.write(self.style.SUCCESS(f"{len(saved)} saved, {len(not_found)} not found, {len(failed)} failed."))
        if saved:
            self.stdout.write(f"Saved: {', '.join(saved)}")


def fetch(client, airline):
    """Downloads and stores the airline's logo; returns saved, not_found or failed."""
    try:
        response = client.get(SOURCE.format(code=airline.iata_code))
    except httpx.HTTPError:
        return "failed"
    if response.status_code != 200:
        return "not_found"
    content = ContentFile(response.content, name=f"{airline.iata_code}.png")
    try:
        validate_logo(content)
    except ValidationError:
        return "failed"
    airline.logo.save(content.name, content)
    return "saved"
