from rest_framework import serializers

from .models import Airline


class AirlineSerializer(serializers.ModelSerializer):
    """logo_url: absolute, on the request's host (so each agency's host serves it); null without a logo."""

    logo_url = serializers.SerializerMethodField()

    class Meta:
        model = Airline
        fields = ["id", "iata_code", "name", "logo_url"]
        read_only_fields = fields

    def get_logo_url(self, airline):
        if not airline.logo:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(airline.logo.url) if request else airline.logo.url
