from django.conf import settings
from django.http import Http404, JsonResponse
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core.tenancy import agency_code, app_address

NO_TENANT = {"detail": "There is no agency at this address.", "code": "no_tenant"}
SUSPENDED = {"detail": "This agency is not available at the moment.", "code": "tenant_suspended"}


def no_tenant(request, *args, **kwargs):
    """For unknown hosts, and for agency API paths on the root host."""
    return JsonResponse(NO_TENANT, status=404)


def suspended_body(tenant):
    """The tenant_suspended response; a suspension for non-payment says whom to contact."""
    if tenant.suspension_reason == tenant.SuspensionReason.NON_PAYMENT:
        from .models import PlatformSettings

        contact = PlatformSettings.get().billing_contact_email
        detail = "This agency's account is suspended for non-payment." + (f" Contact {contact}." if contact else "")
        return {"detail": detail, "code": "tenant_suspended"}
    return SUSPENDED


class AgencyView(APIView):
    """The agency at this address, for the mobile app finding its agency from a code or a link."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        tenant = request.tenant
        return Response(
            {
                "code": agency_code(tenant.schema_name),
                "name": tenant.name,
                "app_address": app_address(tenant.schema_name),
            }
        )


# Link verification for the mobile app (iOS universal links, Android app links). Served on every agency host and
# on the root host, which Android checks for a wildcard (*.<TENANT_BASE_DOMAIN>) intent filter.


def apple_app_site_association(request):
    if not settings.IOS_APP_ID:
        raise Http404
    return JsonResponse({"applinks": {"details": [{"appIDs": [settings.IOS_APP_ID], "components": [{"/": "*"}]}]}})


def assetlinks(request):
    if not settings.ANDROID_PACKAGE or not settings.ANDROID_CERT_FINGERPRINTS:
        raise Http404
    return JsonResponse(
        [
            {
                "relation": ["delegate_permission/common.handle_all_urls"],
                "target": {
                    "namespace": "android_app",
                    "package_name": settings.ANDROID_PACKAGE,
                    "sha256_cert_fingerprints": settings.ANDROID_CERT_FINGERPRINTS,
                },
            }
        ],
        safe=False,
    )
