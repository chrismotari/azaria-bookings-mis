from django.apps import AppConfig


class AirportsConfig(AppConfig):
    """Shared by every tenant: seeded once in the public schema."""

    name = "airports"
