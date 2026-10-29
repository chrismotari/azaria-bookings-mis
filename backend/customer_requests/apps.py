from django.apps import AppConfig


class RequestsConfig(AppConfig):
    # The package is not called "requests" so it does not shadow the PyPI library of that name.
    name = "customer_requests"
    label = "requests"
