import uuid

from django.db import models
from django_tenants.models import DomainMixin, TenantMixin

from core.storage import private_storage


class Tenant(TenantMixin):
    """A travel agency with its own PostgreSQL schema. The public schema's row is the platform itself (app_admin).

    Tenants are suspended (is_active false), never deleted.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class SuspensionReason(models.TextChoices):
        MANUAL = "manual", "Suspended by the system owner"
        NON_PAYMENT = "non_payment", "Suspended for non-payment"

    name = models.CharField(max_length=100)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # Where invoices are sent; required before a subscription can start.
    billing_email = models.EmailField(blank=True)
    # Set when suspended (is_active false), cleared on reactivation.
    suspension_reason = models.CharField(max_length=20, choices=SuspensionReason.choices, blank=True)
    suspended_at = models.DateTimeField(null=True, blank=True)
    # Fare searches the agency may run per calendar month (Nairobi time), across all its routes and integrations.
    monthly_search_allowance = models.PositiveIntegerField(default=1500)

    auto_create_schema = True
    auto_drop_schema = False

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    @property
    def primary_domain(self):
        domain = self.domains.filter(is_primary=True).first()
        return domain.domain if domain else None


class Domain(DomainMixin):
    """A hostname that reaches a tenant; the primary one is used in email links."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    def __str__(self):
        return self.domain


class PlatformSettings(models.Model):
    """The platform's billing and support settings. Single row, created by a data migration."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    issuer_details = models.TextField(blank=True, help_text="The platform's name and address, printed on invoices.")
    payment_instructions = models.TextField(blank=True)
    invoice_due_days = models.PositiveIntegerField(default=14)
    invoice_lead_days = models.PositiveIntegerField(default=7)
    billing_contact_email = models.EmailField(blank=True)
    # Where the platform's support desk is notified of new chats and messages.
    support_email = models.EmailField(blank=True)

    class Meta:
        verbose_name = "platform settings"
        verbose_name_plural = "platform settings"

    def __str__(self):
        return "Platform settings"

    @classmethod
    def get(cls):
        return cls.objects.get()


class BillingCycle(models.TextChoices):
    MONTHLY = "monthly", "Monthly"
    ANNUAL = "annual", "Annual"


class Plan(models.Model):
    """What agencies pay for. Deactivated, never deleted; an inactive plan cannot be chosen for a subscription."""

    class Kind(models.TextChoices):
        SUBSCRIPTION = "subscription", "Subscription"
        SUPPORT = "support", "Support"

    class Tag(models.TextChoices):
        """Featured places on the plans page, shown in this order."""

        RECOMMENDED = "recommended", "Recommended"
        BASIC = "basic", "Basic"
        ADVANCED = "advanced", "Advanced"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    kind = models.CharField(max_length=20, choices=Kind.choices)
    # Sanitized HTML (tenants.richtext).
    description = models.TextField(blank=True)
    # Subscription plans only; each tag on at most one plan; cleared when the plan is deactivated.
    tag = models.CharField(max_length=20, choices=Tag.choices, blank=True)
    monthly_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    annual_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["kind", "name"]
        constraints = [
            models.UniqueConstraint(fields=["tag"], condition=~models.Q(tag=""), name="one_plan_per_tag"),
        ]

    def __str__(self):
        return self.name

    def price_for(self, cycle):
        return self.monthly_price if cycle == BillingCycle.MONTHLY else self.annual_price


class Subscription(models.Model):
    """An agency's plan. At most one running (ended_on null) per plan kind and agency."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.PROTECT, related_name="subscriptions")
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="subscriptions")
    # Copied from the plan: the plan's kind never changes, and this keeps the one-per-kind rule a constraint.
    kind = models.CharField(max_length=20, choices=Plan.Kind.choices)
    billing_cycle = models.CharField(max_length=10, choices=BillingCycle.choices)
    started_on = models.DateField()
    # The first day of the next period to invoice.
    next_period_start = models.DateField()
    ended_on = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["kind", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "kind"], condition=models.Q(ended_on__isnull=True), name="one_running_per_kind"
            )
        ]

    def __str__(self):
        return f"{self.tenant} – {self.plan}"


def invoice_path(instance, filename):
    # Per tenant; the private storage replaces the file name with a random UUID.
    return f"invoices/{instance.tenant.schema_name}/{filename}"


class Invoice(models.Model):
    """One subscription for one period. Plan, cycle and amount are copied at issue, so later plan edits never
    change it. A paid invoice means the agency is in good standing for that period."""

    class Status(models.TextChoices):
        UNPAID = "unpaid", "Unpaid"
        PAID = "paid", "Paid"
        VOID = "void", "Void"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    number = models.CharField(max_length=20, unique=True)
    tenant = models.ForeignKey(Tenant, on_delete=models.PROTECT, related_name="invoices")
    subscription = models.ForeignKey(Subscription, on_delete=models.PROTECT, related_name="invoices")
    plan_name = models.CharField(max_length=100)
    billing_cycle = models.CharField(max_length=10, choices=BillingCycle.choices)
    period_start = models.DateField()
    period_end = models.DateField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    issued_on = models.DateField()
    due_on = models.DateField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.UNPAID)
    paid_on = models.DateField(null=True, blank=True)
    # Set when the system owner reactivates the agency while this invoice is overdue: it no longer suspends it.
    suspension_waived = models.BooleanField(default=False)
    pdf = models.FileField(storage=private_storage, upload_to=invoice_path, max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-issued_on", "-number"]

    def __str__(self):
        return self.number
