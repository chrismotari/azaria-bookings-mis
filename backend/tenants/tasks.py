"""The platform's billing tasks (public schema): invoice and suspension emails and the two daily jobs."""

import logging

from celery import shared_task
from django_tenants.utils import get_public_schema_name, schema_context

from core.emails import EMAIL_TASK_OPTIONS, send_email

from . import billing
from .models import Invoice, PlatformSettings, Tenant

logger = logging.getLogger(__name__)


def _send_to_agency(tenant, template, subject, context, attachments=()):
    # Links in the email point at the agency's own primary domain.
    with schema_context(tenant.schema_name):
        send_email(template, subject, tenant.billing_email, context, attachments)


@shared_task(**EMAIL_TASK_OPTIONS)
def send_invoice(invoice_id):
    """The invoice with its PDF, to the agency's billing email. Only while it is unpaid."""
    with schema_context(get_public_schema_name()):
        invoice = Invoice.objects.select_related("tenant").filter(pk=invoice_id).first()
        if invoice is None or invoice.status != Invoice.Status.UNPAID or not invoice.tenant.billing_email:
            return
        with invoice.pdf.open("rb") as file:
            content = file.read()
        platform = PlatformSettings.get()
        context = {
            "invoice": invoice,
            "tenant": invoice.tenant,
            "period": f"{billing.format_day(invoice.period_start)} to {billing.format_day(invoice.period_end)}",
            "amount": billing.format_amount(invoice.amount),
            "due": billing.format_day(invoice.due_on),
            "cycle": invoice.get_billing_cycle_display(),
            "payment_instructions": platform.payment_instructions,
            "billing_contact_email": platform.billing_contact_email,
        }
        _send_to_agency(
            invoice.tenant,
            "invoice",
            f"Invoice {invoice.number} from Azaria Bookings",
            context,
            [(f"{invoice.number}.pdf", content, "application/pdf")],
        )


@shared_task(**EMAIL_TASK_OPTIONS)
def notify_tenant_suspended_non_payment(tenant_id):
    """Tells the agency it was suspended for non-payment. Only while it still is."""
    with schema_context(get_public_schema_name()):
        tenant = Tenant.objects.filter(pk=tenant_id).first()
        if (
            tenant is None
            or tenant.is_active
            or tenant.suspension_reason != Tenant.SuspensionReason.NON_PAYMENT
            or not tenant.billing_email
        ):
            return
        platform = PlatformSettings.get()
        invoices = [
            {"number": invoice.number, "amount": billing.format_amount(invoice.amount), "due": billing.format_day(invoice.due_on)}
            for invoice in sorted(billing.blocking_invoices(tenant), key=lambda invoice: invoice.number)
        ]
        context = {
            "tenant": tenant,
            "invoices": invoices,
            "payment_instructions": platform.payment_instructions,
            "billing_contact_email": platform.billing_contact_email,
        }
        _send_to_agency(tenant, "suspended_non_payment", f"{tenant.name} is suspended for non-payment", context)


@shared_task
def issue_due_invoices():
    """Daily: the next invoice of every running subscription whose period starts within the lead days."""
    with schema_context(get_public_schema_name()):
        issued = billing.issue_due_invoices()
    logger.info("Issued %d invoice(s).", issued)
    return issued


@shared_task
def suspend_overdue_tenants():
    """Daily: suspends agencies with an unpaid invoice more than a month past its due date."""
    with schema_context(get_public_schema_name()):
        suspended = billing.suspend_overdue_tenants()
    logger.info("Suspended %d agency(ies) for non-payment.", suspended)
    return suspended
