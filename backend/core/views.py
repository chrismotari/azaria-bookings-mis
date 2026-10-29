from rest_framework import generics

from .models import AppSettings
from .permissions import IsAdminRole
from .serializers import AppSettingsSerializer


class AdminSettingsView(generics.RetrieveUpdateAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = AppSettingsSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_object(self):
        return AppSettings.get()
