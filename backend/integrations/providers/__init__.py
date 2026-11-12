from .base import ProviderError, Result, ResultSegment, SearchRequest
from .duffel import DuffelProvider
from .sabre import SabreProvider
from .travelport import TravelportProvider

PROVIDERS = {"duffel": DuffelProvider, "travelport": TravelportProvider, "sabre": SabreProvider}


def provider_for(integration):
    """The integration's provider, ready to call with its decrypted credentials."""
    return PROVIDERS[integration.provider](integration.get_credentials(), integration.mode)


__all__ = ["PROVIDERS", "ProviderError", "Result", "ResultSegment", "SearchRequest", "provider_for"]
