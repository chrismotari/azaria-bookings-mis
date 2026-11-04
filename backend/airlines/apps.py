from django.apps import AppConfig


class AirlinesConfig(AppConfig):
    """Shared by every tenant: seeded once in the public schema and curated by the system owner."""

    name = "airlines"
