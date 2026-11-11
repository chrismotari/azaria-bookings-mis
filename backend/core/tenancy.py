"""Running work in the right tenant's schema: Celery tasks, scheduled jobs and the links in emails."""

import logging

from celery import shared_task
from django.conf import settings
from django.db import connection, transaction
from django_tenants.utils import get_public_schema_name, schema_context

from tenants.models import Tenant

logger = logging.getLogger(__name__)


def active_tenants():
    """Every active agency (the public schema is the platform, not an agency)."""
    with schema_context(get_public_schema_name()):
        return list(Tenant.objects.filter(is_active=True).exclude(schema_name=get_public_schema_name()))


def tenant_task(**options):
    """A Celery task over one tenant's data, called as task.delay(schema_name, *args).

    It runs inside that tenant's schema, and does nothing if the tenant is gone or suspended.
    """

    def decorator(func):
        def run(schema_name, *args, **kwargs):
            with schema_context(get_public_schema_name()):
                active = (
                    schema_name != get_public_schema_name()
                    and Tenant.objects.filter(schema_name=schema_name, is_active=True).exists()
                )
            if not active:
                logger.info("Skipped %s: tenant %s is missing or suspended.", func.__name__, schema_name)
                return None
            with schema_context(schema_name):
                return func(*args, **kwargs)

        # Not functools.wraps: Celery would then check calls against func's signature, without schema_name.
        run.__name__, run.__qualname__, run.__doc__, run.__module__ = (
            func.__name__,
            func.__qualname__,
            func.__doc__,
            func.__module__,
        )
        return shared_task(name=f"{func.__module__}.{func.__name__}", **options)(run)

    return decorator


def queue(task, *args):
    """Queues a tenant task for the current tenant once the transaction commits."""
    schema_name = connection.schema_name
    transaction.on_commit(lambda: task.delay(schema_name, *args))


def for_each_tenant(job, name):
    """Runs job() in every active tenant's schema in turn and returns the sum of the results.

    An error in one tenant is logged and does not stop the others.
    """
    total = 0
    for tenant in active_tenants():
        try:
            with schema_context(tenant.schema_name):
                total += job()
        except Exception:
            logger.exception("%s failed for tenant %s.", name, tenant.schema_name)
    return total


def agency_code(schema_name):
    """What customers type and the first label of the agency's app address: its schema name with hyphens."""
    return schema_name.replace("_", "-")


def app_address(schema_name=None):
    """<code>.<TENANT_BASE_DOMAIN>: the address every agency has and the mobile app declares, so email links use it
    even when the agency's primary domain is a custom one."""
    return f"{agency_code(schema_name or connection.schema_name)}.{settings.TENANT_BASE_DOMAIN}"


def frontend_url():
    """The web app's base URL: an agency's app address (it opens the mobile app when installed), or the root host
    for the platform's own emails."""
    if connection.schema_name == get_public_schema_name():
        return settings.FRONTEND_URL.format(domain=settings.TENANT_BASE_DOMAIN).rstrip("/")
    return settings.FRONTEND_URL.format(domain=app_address()).rstrip("/")


def current_tenant():
    """The current schema's Tenant row (shared table, readable from any agency schema)."""
    return Tenant.objects.get(schema_name=connection.schema_name)
