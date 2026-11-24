from rest_framework import generics

from tenants.models import Theme
from tenants.serializers import ThemeSerializer

from .models import AppSettings
from .permissions import IsAdminRole
from .serializers import AppSettingsSerializer


class AdminSettingsView(generics.RetrieveUpdateAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = AppSettingsSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_object(self):
        return AppSettings.get()


class AdminThemeListView(generics.ListAPIView):
    """The themes an agency can choose: the active ones, default first."""

    permission_classes = [IsAdminRole]
    serializer_class = ThemeSerializer
    pagination_class = None

    def get_queryset(self):
        return Theme.objects.filter(is_active=True).order_by("-is_default", "name")
