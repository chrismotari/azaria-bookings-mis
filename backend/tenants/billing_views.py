"""Plans, subscriptions, invoices and platform settings: the system owner's API on the root host, and the
read-only billing API for an agency's admins on its own host."""

import uuid

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import connection
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from rest_framework import generics, serializers, status
from rest_framework.exceptions import APIException
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsAdminRole

from . import billing, dashboard
from .billing_serializers import (
    AgencyInvoiceSerializer,
    InvoiceSerializer,
    MarkPaidSerializer,
    PlanSerializer,
    PlatformSettingsSerializer,
    PublicPlanSerializer,
    SubscriptionChangeSerializer,
    SubscriptionCreateSerializer,
    SubscriptionSerializer,
)
from .models import Invoice, Plan, PlatformSettings, Subscription, Tenant
from .permissions import IsPlatformOwner
from .platform_views import agencies


def run(action, *args, **kwargs):
    """Calls a billing function; its errors become 400 (field errors) or 409 (the action does not apply now)."""
    try:
        return action(*args, **kwargs)
    except DjangoValidationError as exc:
        errors = exc.message_dict
        if set(errors) == {"detail"}:
            raise Conflict(errors["detail"][0])
        raise serializers.ValidationError(errors)


class Conflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "conflict"


def pdf_response(invoice):
    if not invoice.pdf:
        raise Http404
    return FileResponse(invoice.pdf.open("rb"), as_attachment=True, filename=f"{invoice.number}.pdf")


# Plans


class PlanListView(generics.ListCreateAPIView):
    permission_classes = [IsPlatformOwner]
    serializer_class = PlanSerializer
    queryset = Plan.objects.all()
    filterset_fields = ["kind", "is_active"]


class PlanDetailView(generics.RetrieveUpdateAPIView):
    """Plans are deactivated (is_active false), never deleted."""

    permission_classes = [IsPlatformOwner]
    serializer_class = PlanSerializer
    queryset = Plan.objects.all()
    http_method_names = ["get", "patch", "head", "options"]


# Subscriptions


class TenantSubscriptionListView(APIView):
    permission_classes = [IsPlatformOwner]

    def get(self, request, pk):
        tenant = get_object_or_404(agencies(), pk=pk)
        subscriptions = tenant.subscriptions.select_related("plan").order_by("ended_on", "kind", "-created_at")
        return Response(SubscriptionSerializer(subscriptions, many=True).data)

    def post(self, request, pk):
        tenant = get_object_or_404(agencies(), pk=pk)
        serializer = SubscriptionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        subscription = run(
            billing.start_subscription,
            tenant,
            data["plan"],
            data["billing_cycle"],
            data.get("started_on") or billing.today(),
        )
        # Read again: issuing the first invoice moved next_period_start.
        subscription = Subscription.objects.select_related("plan").get(pk=subscription.pk)
        return Response(SubscriptionSerializer(subscription).data, status=status.HTTP_201_CREATED)


def running_subscription(pk):
    return get_object_or_404(Subscription.objects.select_related("plan", "tenant"), pk=pk)


class SubscriptionDetailView(APIView):
    permission_classes = [IsPlatformOwner]

    def patch(self, request, pk):
        subscription = running_subscription(pk)
        serializer = SubscriptionChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        subscription = run(billing.change_subscription, subscription, **serializer.validated_data)
        return Response(SubscriptionSerializer(subscription).data)


class SubscriptionEndView(APIView):
    permission_classes = [IsPlatformOwner]

    def post(self, request, pk):
        subscription = run(billing.end_subscription, running_subscription(pk))
        return Response(SubscriptionSerializer(subscription).data)


class SubscriptionIssueInvoiceView(APIView):
    """Issues the subscription's next invoice now, ahead of the daily job."""

    permission_classes = [IsPlatformOwner]

    def post(self, request, pk):
        invoice = run(billing.issue_invoice, running_subscription(pk))
        return Response(InvoiceSerializer(Invoice.objects.select_related("tenant").get(pk=invoice.pk)).data, status=201)


# Invoices


class InvoiceListView(generics.ListAPIView):
    permission_classes = [IsPlatformOwner]
    serializer_class = InvoiceSerializer

    def get_queryset(self):
        queryset = Invoice.objects.select_related("tenant")
        params = self.request.query_params
        if params.get("tenant"):
            try:
                queryset = queryset.filter(tenant_id=uuid.UUID(params["tenant"]))
            except ValueError:
                queryset = queryset.none()
        if params.get("status") in Invoice.Status.values:
            queryset = queryset.filter(status=params["status"])
        if params.get("overdue") == "true":
            queryset = queryset.filter(status=Invoice.Status.UNPAID, due_on__lt=billing.today())
        return queryset


class InvoiceDetailView(generics.RetrieveAPIView):
    permission_classes = [IsPlatformOwner]
    serializer_class = InvoiceSerializer
    queryset = Invoice.objects.select_related("tenant")


class InvoiceActionView(APIView):
    """POST mark-paid {paid_on?}, mark-unpaid, void, resend."""

    permission_classes = [IsPlatformOwner]
    action = None

    def post(self, request, pk):
        invoice = get_object_or_404(Invoice, pk=pk)
        if self.action == "mark-paid":
            serializer = MarkPaidSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            run(billing.mark_paid, invoice, serializer.validated_data.get("paid_on"))
        elif self.action == "mark-unpaid":
            run(billing.mark_unpaid, invoice)
        elif self.action == "void":
            run(billing.void, invoice)
        elif self.action == "resend":
            from .tasks import send_invoice

            if invoice.status != Invoice.Status.UNPAID:
                raise Conflict("Only an unpaid invoice is sent.")
            if not invoice.tenant.billing_email:
                raise Conflict("Add the agency's billing email first.")
            send_invoice.delay(str(invoice.pk))
        return Response(InvoiceSerializer(Invoice.objects.select_related("tenant").get(pk=pk)).data)


class InvoicePdfView(APIView):
    permission_classes = [IsPlatformOwner]

    def get(self, request, pk):
        return pdf_response(get_object_or_404(Invoice, pk=pk))


class PlatformSettingsView(generics.RetrieveUpdateAPIView):
    permission_classes = [IsPlatformOwner]
    serializer_class = PlatformSettingsSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_object(self):
        return PlatformSettings.get()


def offered_plans():
    return Plan.objects.filter(is_active=True).order_by("kind", "name")


class PublicPlansView(APIView):
    """The pricing page's plans, open to anyone on the root host."""

    permission_classes = [AllowAny]
    # A visitor's stale or foreign token must not turn a public page into a 401.
    authentication_classes = []

    def get(self, request):
        return Response(
            {
                "plans": PublicPlanSerializer(offered_plans(), many=True).data,
                "billing_contact_email": PlatformSettings.get().billing_contact_email,
            }
        )


class PlatformDashboardView(APIView):
    permission_classes = [IsPlatformOwner]

    def get(self, request):
        return Response(dashboard.summary())


# The agency's own billing (its host, its admins)


def this_tenant():
    return Tenant.objects.get(schema_name=connection.schema_name)


class AgencyBillingView(APIView):
    permission_classes = [IsAdminRole]

    def get(self, request):
        tenant = this_tenant()
        subscriptions = tenant.subscriptions.filter(ended_on__isnull=True).select_related("plan")
        overdue = billing.overdue_invoice(tenant)
        return Response(
            {
                "subscriptions": [
                    {
                        "plan_name": item["plan"]["name"],
                        "kind": item["kind"],
                        "billing_cycle": item["billing_cycle"],
                        "price": item["price"],
                        "currency": item["currency"],
                        "next_period_start": item["next_period_start"],
                    }
                    for item in SubscriptionSerializer(subscriptions, many=True).data
                ],
                "billing_contact_email": PlatformSettings.get().billing_contact_email,
                "overdue": overdue
                and {
                    "number": overdue.number,
                    "amount": f"{overdue.amount:.2f}",
                    "currency": AgencyInvoiceSerializer(overdue).data["currency"],
                    "due_on": overdue.due_on,
                    "suspends_on": billing.suspends_on(overdue),
                },
            }
        )


class AgencyPlansView(APIView):
    """The plans page in the agency app: the offered plans and which of them the agency is on."""

    permission_classes = [IsAdminRole]

    def get(self, request):
        running = this_tenant().subscriptions.filter(ended_on__isnull=True).values_list("plan_id", flat=True)
        return Response(
            {
                "plans": PublicPlanSerializer(offered_plans(), many=True).data,
                "current_plan_ids": [str(pk) for pk in running],
                "billing_contact_email": PlatformSettings.get().billing_contact_email,
            }
        )


class AgencyInvoiceListView(generics.ListAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = AgencyInvoiceSerializer

    def get_queryset(self):
        return Invoice.objects.filter(tenant=this_tenant())


class AgencyInvoicePdfView(APIView):
    permission_classes = [IsAdminRole]

    def get(self, request, pk):
        return pdf_response(get_object_or_404(Invoice, pk=pk, tenant=this_tenant()))
