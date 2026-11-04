import django_filters
from django.db.models import Q

from .models import User


class AdminCustomerFilter(django_filters.FilterSet):
    search = django_filters.CharFilter(method="filter_search")
    is_active = django_filters.BooleanFilter()

    class Meta:
        model = User
        fields = []

    def filter_search(self, queryset, name, value):
        value = value.strip()
        if not value:
            return queryset
        return queryset.filter(
            Q(full_name__icontains=value) | Q(email__icontains=value) | Q(phone__icontains=value)
        )
