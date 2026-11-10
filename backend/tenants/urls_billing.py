"""The agency's own billing, read-only, for its admins (on the agency's host)."""

from django.urls import path

from . import billing_views as views

urlpatterns = [
    path("admin/billing", views.AgencyBillingView.as_view()),
    path("admin/billing/invoices", views.AgencyInvoiceListView.as_view()),
    path("admin/billing/invoices/<uuid:pk>/pdf", views.AgencyInvoicePdfView.as_view()),
]
