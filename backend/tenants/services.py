import re

from django.conf import settings
from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django_tenants.utils import get_public_schema_name, schema_context, schema_exists

from accounts.models import User
from core.models import AppSettings

from .models import Domain, Tenant

# What the system owner types: also the first label of the tenant's hostname.
SLUG = re.compile(r"^[a-z][a-z0-9-]{2,29}$")
RESERVED = {"public", "www", "api", "admin", "app-admin", "information-schema"}


def schema_name_for(slug):
    """PostgreSQL schema names cannot contain hyphens; the hostname keeps them."""
    return slug.replace("-", "_")


def domain_for(slug):
    return f"{slug}.{settings.TENANT_BASE_DOMAIN}"


def validate_slug(slug):
    if not SLUG.match(slug):
        raise ValidationError(
            "Use 3 to 30 lowercase letters, digits and hyphens, starting with a letter.", code="invalid"
        )
    if slug in RESERVED:
        raise ValidationError(f"{slug} is reserved.", code="reserved")
    with schema_context(get_public_schema_name()):
        taken = (
            Tenant.objects.filter(schema_name__iexact=schema_name_for(slug)).exists()
            or Domain.objects.filter(domain=domain_for(slug)).exists()
            # Any other schema already in the database (e.g. PostgreSQL's own).
            or schema_exists(schema_name_for(slug))
        )
    if taken:
        raise ValidationError(f"{slug} is already in use.", code="taken")


def validate_first_admin(email, password, full_name):
    """Raises ValidationError with a dict of field errors (admin_email, admin_password, admin_name)."""
    errors = {}
    try:
        validate_email(email)
    except ValidationError:
        errors["admin_email"] = ["Enter a valid email address."]
    if not full_name.strip():
        errors["admin_name"] = ["Enter the admin's name."]
    try:
        password_validation.validate_password(password, User(email=email, full_name=full_name))
    except ValidationError as exc:
        errors["admin_password"] = exc.messages
    if errors:
        raise ValidationError(errors)


def create_agency(*, slug, name, admin_email, admin_password, admin_name):
    """Creates a tenant with its schema (migrated), primary domain, settings and first admin.

    Raises ValidationError for bad input. It is one transaction (PostgreSQL rolls back schema changes too),
    so if any part fails nothing is left behind.
    """
    validate_slug(slug)
    if not name.strip():
        raise ValidationError({"name": ["Enter the agency's name."]})
    admin_email = User.objects.normalize_email(admin_email)
    validate_first_admin(admin_email, admin_password, admin_name)

    with schema_context(get_public_schema_name()), transaction.atomic():
        tenant = Tenant(schema_name=schema_name_for(slug), name=name.strip())
        # Creates and migrates the schema.
        tenant.save(verbosity=0)
        Domain.objects.create(domain=domain_for(slug), tenant=tenant, is_primary=True)
        with schema_context(tenant.schema_name):
            AppSettings.objects.update(admin_notification_email=admin_email)
            User.objects.create_user(
                email=admin_email, password=admin_password, full_name=admin_name.strip(), role=User.Role.ADMIN
            )
    return tenant
