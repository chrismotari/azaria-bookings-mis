"""Plans, subscriptions, invoices and suspension for non-payment. Public schema only.

Payment happens outside the system: the platform issues invoices, the system owner marks them paid, and an
agency whose invoice stays unpaid for a month past its due date is suspended.
"""

import logging

from dateutil.relativedelta import relativedelta
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone
from django_tenants.utils import get_public_schema_name

from .models import BillingCycle, Invoice, Plan, PlatformSettings, Subscription, Tenant

logger = logging.getLogger(__name__)

# How long an invoice may stay unpaid after its due date before the agency is suspended.
GRACE = relativedelta(months=1)


def today():
    return timezone.localdate()


def format_amount(amount):
    return f"{settings.PLATFORM_CURRENCY} {amount:,.2f}"


def format_day(value):
    return f"{value.day} {value:%b %Y}"


def next_period_start(subscription, start):
    """The day after the period that begins on start. Periods keep the day of the month the subscription
    started on (clamped to shorter months), so a subscription started on the 31st does not drift."""
    step = {"months": 1} if subscription.billing_cycle == BillingCycle.MONTHLY else {"years": 1}
    return start + relativedelta(day=subscription.started_on.day, **step)


def suspends_on(invoice):
    """The first day the agency can be suspended for this invoice: one month after its due date has passed."""
    return invoice.due_on + GRACE + relativedelta(days=1)


def is_past_limit(invoice, on=None):
    return invoice.due_on + GRACE < (on or today())


def blocking_invoices(tenant, on=None):
    """Unpaid, not waived invoices past the one-month limit: the ones that suspend the agency."""
    candidates = Invoice.objects.filter(
        tenant=tenant, status=Invoice.Status.UNPAID, suspension_waived=False, due_on__lt=on or today()
    )
    return [invoice for invoice in candidates if is_past_limit(invoice, on)]


def overdue_invoice(tenant):
    """The oldest unpaid, not waived invoice past its due date (the agency's overdue notice), or None."""
    return (
        Invoice.objects.filter(
            tenant=tenant, status=Invoice.Status.UNPAID, suspension_waived=False, due_on__lt=today()
        )
        .order_by("due_on", "number")
        .first()
    )


# Plans and subscriptions


def check_plan_for(plan, cycle):
    if not plan.is_active:
        raise ValidationError({"plan": ["This plan is no longer offered."]})
    if plan.price_for(cycle) is None:
        raise ValidationError({"billing_cycle": [f"{plan.name} has no {BillingCycle(cycle).label.lower()} price."]})


def start_subscription(tenant, plan, billing_cycle, started_on):
    """Starts a plan for an agency and issues its first invoice at once, for the period starting on started_on."""
    if not tenant.billing_email:
        raise ValidationError({"billing_email": ["Add the agency's billing email first."]})
    check_plan_for(plan, billing_cycle)
    with transaction.atomic():
        Tenant.objects.select_for_update().get(pk=tenant.pk)
        if Subscription.objects.filter(tenant=tenant, kind=plan.kind, ended_on__isnull=True).exists():
            raise ValidationError(
                {"plan": [f"This agency already has a {Plan.Kind(plan.kind).label.lower()} plan. Change or end it."]}
            )
        subscription = Subscription.objects.create(
            tenant=tenant,
            plan=plan,
            kind=plan.kind,
            billing_cycle=billing_cycle,
            started_on=started_on,
            next_period_start=started_on,
        )
        issue_invoice(subscription)
    return subscription


def change_subscription(subscription, plan=None, billing_cycle=None):
    """Applies from the next invoice issued; invoices already issued are unchanged (no proration)."""
    if subscription.ended_on:
        raise ValidationError({"detail": ["This subscription has ended."]})
    plan = plan or subscription.plan
    billing_cycle = billing_cycle or subscription.billing_cycle
    if plan.kind != subscription.kind:
        raise ValidationError({"plan": [f"Choose a {Plan.Kind(subscription.kind).label.lower()} plan."]})
    if plan != subscription.plan or billing_cycle != subscription.billing_cycle:
        check_plan_for(plan, billing_cycle)
    subscription.plan, subscription.billing_cycle = plan, billing_cycle
    subscription.save(update_fields=["plan", "billing_cycle"])
    return subscription


def end_subscription(subscription):
    if subscription.ended_on:
        raise ValidationError({"detail": ["This subscription has already ended."]})
    subscription.ended_on = today()
    subscription.save(update_fields=["ended_on"])
    return subscription


# Invoices


def next_number(year):
    """INV-<year>-<4-digit sequence per year>. Call with PlatformSettings locked, so numbers are never shared."""
    prefix = f"INV-{year}-"
    last = Invoice.objects.filter(number__startswith=prefix).order_by("-number").values_list("number", flat=True)
    sequence = int(last[0].removeprefix(prefix)) + 1 if last else 1
    return f"{prefix}{sequence:04d}"


def issue_invoice(subscription):
    """Invoices the subscription's next period, advances it, stores the PDF and queues the invoice email on commit."""
    from .tasks import send_invoice

    with transaction.atomic():
        platform = PlatformSettings.objects.select_for_update().get()
        subscription = Subscription.objects.select_for_update().select_related("plan", "tenant").get(
            pk=subscription.pk
        )
        if subscription.ended_on:
            raise ValidationError({"detail": ["This subscription has ended."]})
        amount = subscription.plan.price_for(subscription.billing_cycle)
        if amount is None:
            raise ValidationError(
                {"billing_cycle": [f"{subscription.plan.name} has no price for this subscription's cycle."]}
            )
        start = subscription.next_period_start
        end = next_period_start(subscription, start)
        issued_on = today()
        invoice = Invoice(
            number=next_number(issued_on.year),
            tenant=subscription.tenant,
            subscription=subscription,
            plan_name=subscription.plan.name,
            billing_cycle=subscription.billing_cycle,
            period_start=start,
            period_end=end - relativedelta(days=1),
            amount=amount,
            issued_on=issued_on,
            due_on=issued_on + relativedelta(days=platform.invoice_due_days),
        )
        _store_pdf(invoice, platform)
        invoice.save()
        subscription.next_period_start = end
        subscription.save(update_fields=["next_period_start"])
        transaction.on_commit(lambda: send_invoice.delay(str(invoice.pk)))
    return invoice


def issue_due_invoices():
    """Issues the next invoice of every running subscription whose next period starts within the lead days.

    One per subscription per run, so a missed day catches up the next. Returns how many were issued.
    """
    lead = PlatformSettings.get().invoice_lead_days
    due = Subscription.objects.filter(
        ended_on__isnull=True, next_period_start__lte=today() + relativedelta(days=lead)
    ).values_list("pk", flat=True)
    issued = 0
    for pk in list(due):
        try:
            issue_invoice(Subscription(pk=pk))
            issued += 1
        except Exception:
            logger.exception("Could not issue the next invoice of subscription %s.", pk)
    return issued


def _store_pdf(invoice, platform=None):
    """(Re)renders the invoice's PDF, which shows its status, and deletes the one it replaces."""
    old = invoice.pdf.name
    content = ContentFile(render_pdf(invoice, platform or PlatformSettings.get()))
    invoice.pdf.save(f"{invoice.number}.pdf", content, save=False)
    if old:
        transaction.on_commit(lambda: invoice.pdf.storage.delete(old))


def _lift_non_payment_suspension(tenant):
    """Reactivates an agency suspended for non-payment once nothing keeps it suspended."""
    tenant = Tenant.objects.select_for_update().get(pk=tenant.pk)
    if tenant.suspension_reason == Tenant.SuspensionReason.NON_PAYMENT and not blocking_invoices(tenant):
        set_active(tenant, True)


def mark_paid(invoice, paid_on=None):
    with transaction.atomic():
        invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
        if invoice.status != Invoice.Status.UNPAID:
            raise ValidationError({"detail": ["Only an unpaid invoice can be marked paid."]})
        invoice.status, invoice.paid_on = Invoice.Status.PAID, paid_on or today()
        _store_pdf(invoice)
        invoice.save(update_fields=["status", "paid_on", "pdf"])
        _lift_non_payment_suspension(invoice.tenant)
    return invoice


def mark_unpaid(invoice):
    """Corrects a mistake; if it is past the limit, the next daily run suspends the agency."""
    with transaction.atomic():
        invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
        if invoice.status != Invoice.Status.PAID:
            raise ValidationError({"detail": ["Only a paid invoice can be marked unpaid."]})
        invoice.status, invoice.paid_on = Invoice.Status.UNPAID, None
        _store_pdf(invoice)
        invoice.save(update_fields=["status", "paid_on", "pdf"])
    return invoice


def void(invoice):
    with transaction.atomic():
        invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
        if invoice.status != Invoice.Status.UNPAID:
            raise ValidationError({"detail": ["Only an unpaid invoice can be voided."]})
        invoice.status = Invoice.Status.VOID
        _store_pdf(invoice)
        invoice.save(update_fields=["status", "pdf"])
        # A voided invoice is no longer owed.
        _lift_non_payment_suspension(invoice.tenant)
    return invoice


# Suspension


def set_active(tenant, active, reason=Tenant.SuspensionReason.MANUAL):
    """Suspends (recording why) or reactivates an agency.

    Reactivating an agency suspended for non-payment waives the invoices that suspended it, so the daily job does
    not suspend it again for them; a later invoice past the limit still does.
    """
    with transaction.atomic():
        tenant = Tenant.objects.select_for_update().get(pk=tenant.pk)
        if tenant.is_active == active:
            return tenant
        if active:
            if tenant.suspension_reason == Tenant.SuspensionReason.NON_PAYMENT:
                Invoice.objects.filter(pk__in=[invoice.pk for invoice in blocking_invoices(tenant)]).update(
                    suspension_waived=True
                )
            tenant.is_active, tenant.suspension_reason, tenant.suspended_at = True, "", None
        else:
            tenant.is_active, tenant.suspension_reason, tenant.suspended_at = False, reason, timezone.now()
        # update(), not save(): django-tenants only saves a tenant from the public schema or its own.
        Tenant.objects.filter(pk=tenant.pk).update(
            is_active=tenant.is_active, suspension_reason=tenant.suspension_reason, suspended_at=tenant.suspended_at
        )
    return tenant


def suspend_overdue_tenants():
    """Suspends every active agency with an invoice past the limit and queues the suspension email. Returns how many."""
    from .tasks import notify_tenant_suspended_non_payment

    suspended = 0
    agencies = Tenant.objects.filter(is_active=True).exclude(schema_name=get_public_schema_name())
    for tenant in agencies.filter(invoices__status=Invoice.Status.UNPAID).distinct():
        try:
            with transaction.atomic():
                if not blocking_invoices(tenant):
                    continue
                set_active(tenant, False, Tenant.SuspensionReason.NON_PAYMENT)
                transaction.on_commit(lambda pk=tenant.pk: notify_tenant_suspended_non_payment.delay(pk))
            suspended += 1
        except Exception:
            logger.exception("Could not check tenant %s for overdue invoices.", tenant.schema_name)
    return suspended


# PDF


def _latin1(text):
    # The PDF's built-in fonts cover Latin-1 only.
    return str(text).encode("latin-1", "replace").decode("latin-1")


def render_pdf(invoice, platform):
    from fpdf import FPDF

    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_title(_latin1(f"Invoice {invoice.number}"))
    width = pdf.epw

    pdf.set_font("Helvetica", "B", 20)
    pdf.set_text_color(0x18, 0x00, 0xD2)
    pdf.cell(width / 2, 10, "INVOICE")
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(0x25, 0x25, 0x25)
    pdf.cell(width / 2, 10, _latin1(invoice.number), align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    pdf.set_font("Helvetica", "", 10)
    top = pdf.get_y()
    pdf.multi_cell(width / 2 - 5, 5, _latin1(platform.issuer_details or "Azaria Bookings"))
    left_bottom = pdf.get_y()
    pdf.set_xy(pdf.l_margin + width / 2, top)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(width / 2, 5, "Billed to", new_x="LEFT", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(width / 2, 5, _latin1(f"{invoice.tenant.name}\n{invoice.tenant.billing_email}"))
    pdf.set_y(max(left_bottom, pdf.get_y()) + 6)

    rows = [
        ("Issued", format_day(invoice.issued_on)),
        ("Due", format_day(invoice.due_on)),
        (
            "Status",
            f"Paid on {format_day(invoice.paid_on)}" if invoice.paid_on else invoice.get_status_display(),
        ),
    ]
    for label, value in rows:
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(35, 6, label)
        pdf.set_font("Helvetica", "", 10)
        pdf.cell(0, 6, _latin1(value), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)

    pdf.set_fill_color(0xEB, 0xE8, 0xFD)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(width * 0.4, 8, "Plan", fill=True)
    pdf.cell(width * 0.2, 8, "Cycle", fill=True)
    pdf.cell(width * 0.25, 8, "Period", fill=True)
    pdf.cell(width * 0.15, 8, "Amount", fill=True, align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(width * 0.4, 8, _latin1(invoice.plan_name))
    pdf.cell(width * 0.2, 8, invoice.get_billing_cycle_display())
    pdf.cell(width * 0.25, 8, f"{format_day(invoice.period_start)} - {format_day(invoice.period_end)}")
    pdf.cell(width * 0.15, 8, f"{invoice.amount:,.2f}", align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(0xDD, 0xE2, 0xE5)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.l_margin + width, pdf.get_y())
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(width * 0.85, 10, "Total", align="R")
    pdf.cell(width * 0.15, 10, _latin1(format_amount(invoice.amount)), align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)

    if platform.payment_instructions:
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(0, 6, "How to pay", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 10)
        pdf.multi_cell(0, 5, _latin1(platform.payment_instructions))
    return bytes(pdf.output())
