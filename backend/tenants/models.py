from django.db import models
from django_tenants.models import DomainMixin, TenantMixin


class Tenant(TenantMixin):
    """A travel agency with its own PostgreSQL schema. The public schema's row is the platform itself (app_admin).

    Tenants are suspended (is_active false), never deleted.
    """

    name = models.CharField(max_length=100)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

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

    def __str__(self):
        return self.domain
