from django.apps import AppConfig


class RatesConfig(AppConfig):
    """Exchange rates to USD, shared by every agency (public schema)."""

    name = "rates"
