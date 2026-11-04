import django_filters
from django.db.models import Count, Q

from .models import Offer


def _airport_matches(prefix, value):
    """Airport code exact match, or city/country/name contains."""
    return (
        Q(**{f"{prefix}__code__iexact": value})
        | Q(**{f"{prefix}__city__icontains": value})
        | Q(**{f"{prefix}__country__icontains": value})
        | Q(**{f"{prefix}__name__icontains": value})
    )


class OfferFilter(django_filters.FilterSet):
    origin = django_filters.CharFilter(method="filter_airport")
    destination = django_filters.CharFilter(method="filter_airport")
    date_from = django_filters.DateFilter(field_name="departure_date", lookup_expr="gte")
    date_to = django_filters.DateFilter(field_name="departure_date", lookup_expr="lte")
    price_min = django_filters.NumberFilter(field_name="price", lookup_expr="gte")
    price_max = django_filters.NumberFilter(field_name="price", lookup_expr="lte")
    ticket_class = django_filters.ChoiceFilter(choices=Offer.TicketClass.choices)
    # Counts every stop, layovers and stopovers alike.
    max_stopovers = django_filters.NumberFilter(method="filter_max_stops")
    ordering = django_filters.OrderingFilter(fields=["price", "departure_date"])

    class Meta:
        model = Offer
        fields = []

    def filter_airport(self, queryset, name, value):
        value = value.strip()
        if not value:
            return queryset
        return queryset.filter(_airport_matches(name, value))

    def filter_max_stops(self, queryset, name, value):
        # A subquery rather than annotating the queryset, which would group it and drop the default ordering.
        too_many = Offer.objects.annotate(number_of_stops=Count("stops")).filter(number_of_stops__gt=value)
        return queryset.exclude(pk__in=too_many.values("pk"))


class AdminOfferFilter(OfferFilter):
    is_active = django_filters.BooleanFilter()
    is_public = django_filters.BooleanFilter()
