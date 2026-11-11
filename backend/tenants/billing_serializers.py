from django.conf import settings
from rest_framework import serializers

from . import billing, richtext
from .models import Invoice, Plan, PlatformSettings, Subscription


class CurrencyField(serializers.Field):
    """Read-only: the platform's one currency (PLATFORM_CURRENCY)."""

    def __init__(self, **kwargs):
        super().__init__(source="*", read_only=True, **kwargs)

    def to_representation(self, value):
        return settings.PLATFORM_CURRENCY


class PlanSerializer(serializers.ModelSerializer):
    currency = CurrencyField()
    # Declared so the model's one-plan-per-tag check (with its generic message) does not run before validate,
    # which names the plan holding the tag.
    tag = serializers.ChoiceField(choices=Plan.Tag.choices, allow_blank=True, required=False)
    monthly_price = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=0, allow_null=True, required=False
    )
    annual_price = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=0, allow_null=True, required=False
    )

    class Meta:
        model = Plan
        fields = [
            "id",
            "name",
            "kind",
            "tag",
            "description",
            "monthly_price",
            "annual_price",
            "currency",
            "is_active",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def validate_description(self, value):
        cleaned = richtext.sanitize(value)
        if len(cleaned) > richtext.MAX_LENGTH:
            raise serializers.ValidationError(
                f"Keep the description under {richtext.MAX_LENGTH:,} characters of formatted text."
            )
        return cleaned

    def validate_name(self, value):
        if not value.strip():
            raise serializers.ValidationError("Enter the plan's name.")
        return value.strip()

    def validate(self, attrs):
        plan = self.instance
        if plan and "kind" in attrs and attrs["kind"] != plan.kind:
            raise serializers.ValidationError({"kind": "A plan's kind cannot be changed."})
        prices = {
            cycle: attrs.get(f"{cycle}_price", getattr(plan, f"{cycle}_price", None)) for cycle in ["monthly", "annual"]
        }
        self._validate_tag(attrs)
        if all(price is None for price in prices.values()):
            raise serializers.ValidationError({"monthly_price": "Set a monthly price, an annual price or both."})
        if plan:
            for cycle, price in prices.items():
                if price is None and plan.subscriptions.filter(ended_on__isnull=True, billing_cycle=cycle).exists():
                    raise serializers.ValidationError(
                        {f"{cycle}_price": f"Agencies pay this plan {cycle}; keep a {cycle} price."}
                    )
        return attrs

    def _validate_tag(self, attrs):
        plan = self.instance
        active = attrs.get("is_active", plan.is_active if plan else True)
        if not active:
            # Deactivating a plan clears its tag.
            attrs["tag"] = ""
            return
        tag = attrs.get("tag", plan.tag if plan else "")
        if not tag:
            return
        kind = attrs.get("kind", plan.kind if plan else None)
        if kind != Plan.Kind.SUBSCRIPTION:
            raise serializers.ValidationError({"tag": "Only subscription plans can be tagged."})
        holder = Plan.objects.filter(tag=tag).exclude(pk=plan.pk if plan else None).first()
        if holder:
            raise serializers.ValidationError({"tag": f"Already used by {holder.name}."})


class PublicPlanSerializer(serializers.ModelSerializer):
    """A plan on the pricing pages."""

    currency = CurrencyField()

    class Meta:
        model = Plan
        fields = ["id", "name", "kind", "tag", "description", "monthly_price", "annual_price", "currency"]
        read_only_fields = fields


class PlanSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Plan
        fields = ["id", "name", "kind"]
        read_only_fields = fields


class SubscriptionSerializer(serializers.ModelSerializer):
    plan = PlanSummarySerializer(read_only=True)
    price = serializers.SerializerMethodField()
    currency = CurrencyField()

    class Meta:
        model = Subscription
        fields = [
            "id",
            "plan",
            "kind",
            "billing_cycle",
            "price",
            "currency",
            "started_on",
            "next_period_start",
            "ended_on",
            "created_at",
        ]
        read_only_fields = fields

    def get_price(self, subscription):
        price = subscription.plan.price_for(subscription.billing_cycle)
        return None if price is None else f"{price:.2f}"


class SubscriptionCreateSerializer(serializers.Serializer):
    plan = serializers.PrimaryKeyRelatedField(queryset=Plan.objects.all())
    billing_cycle = serializers.ChoiceField(choices=Subscription._meta.get_field("billing_cycle").choices)
    started_on = serializers.DateField(required=False)


class SubscriptionChangeSerializer(serializers.Serializer):
    plan = serializers.PrimaryKeyRelatedField(queryset=Plan.objects.all(), required=False)
    billing_cycle = serializers.ChoiceField(
        choices=Subscription._meta.get_field("billing_cycle").choices, required=False
    )


class InvoiceTenantSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()


class AgencyInvoiceSerializer(serializers.ModelSerializer):
    """An invoice as the agency's admins see it."""

    currency = CurrencyField()
    overdue = serializers.SerializerMethodField()

    class Meta:
        model = Invoice
        fields = [
            "id",
            "number",
            "plan_name",
            "billing_cycle",
            "period_start",
            "period_end",
            "amount",
            "currency",
            "issued_on",
            "due_on",
            "status",
            "paid_on",
            "overdue",
        ]
        read_only_fields = fields

    def get_overdue(self, invoice):
        return invoice.status == Invoice.Status.UNPAID and invoice.due_on < billing.today()


class InvoiceSerializer(AgencyInvoiceSerializer):
    """An invoice as the system owner sees it."""

    tenant = InvoiceTenantSerializer(read_only=True)
    suspends_on = serializers.SerializerMethodField()

    class Meta(AgencyInvoiceSerializer.Meta):
        fields = [
            *AgencyInvoiceSerializer.Meta.fields,
            "tenant",
            "subscription",
            "suspension_waived",
            "suspends_on",
            "created_at",
        ]
        read_only_fields = fields

    def get_suspends_on(self, invoice):
        if invoice.status != Invoice.Status.UNPAID or invoice.suspension_waived:
            return None
        return billing.suspends_on(invoice)


class MarkPaidSerializer(serializers.Serializer):
    paid_on = serializers.DateField(required=False)

    def validate_paid_on(self, value):
        if value > billing.today():
            raise serializers.ValidationError("The payment date cannot be in the future.")
        return value


class PlatformSettingsSerializer(serializers.ModelSerializer):
    currency = CurrencyField()

    class Meta:
        model = PlatformSettings
        fields = [
            "issuer_details",
            "payment_instructions",
            "invoice_due_days",
            "invoice_lead_days",
            "billing_contact_email",
            "support_email",
            "currency",
        ]
