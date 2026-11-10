from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from accounts.tokens import TenantTokenRefreshSerializer

from support import views as support

from . import billing_views as billing
from . import platform_views as views

urlpatterns = [
    path("login", views.PlatformLoginView.as_view()),
    path("refresh", TokenRefreshView.as_view(serializer_class=TenantTokenRefreshSerializer)),
    path("me", views.PlatformMeView.as_view()),
    path("tenants", views.PlatformTenantListView.as_view()),
    path("tenants/<int:pk>", views.PlatformTenantDetailView.as_view()),
    path("tenants/<int:pk>/domains", views.PlatformDomainListView.as_view()),
    path("tenants/<int:pk>/domains/<int:domain_id>", views.PlatformDomainDetailView.as_view()),
    path("tenants/<int:pk>/domains/<int:domain_id>/make-primary", views.PlatformDomainMakePrimaryView.as_view()),
    path("tenants/<int:pk>/subscriptions", billing.TenantSubscriptionListView.as_view()),
    path("plans", billing.PlanListView.as_view()),
    path("plans/<uuid:pk>", billing.PlanDetailView.as_view()),
    path("subscriptions/<uuid:pk>", billing.SubscriptionDetailView.as_view()),
    path("subscriptions/<uuid:pk>/end", billing.SubscriptionEndView.as_view()),
    path("subscriptions/<uuid:pk>/issue-invoice", billing.SubscriptionIssueInvoiceView.as_view()),
    path("invoices", billing.InvoiceListView.as_view()),
    path("invoices/<uuid:pk>", billing.InvoiceDetailView.as_view()),
    path("invoices/<uuid:pk>/pdf", billing.InvoicePdfView.as_view()),
    *[
        path(f"invoices/<uuid:pk>/{action}", billing.InvoiceActionView.as_view(action=action))
        for action in ["mark-paid", "mark-unpaid", "void", "resend"]
    ],
    path("settings", billing.PlatformSettingsView.as_view()),
    path("dashboard", billing.PlatformDashboardView.as_view()),
    path("public-plans", billing.PublicPlansView.as_view()),
    # The platform's support desk (step 32).
    path("support/chats", support.PlatformChatsView.as_view()),
    path("support/attachments/<uuid:pk>", support.PlatformAttachmentView.as_view()),
    path("chats", support.PlatformDeskChatListView.as_view()),
    path("chats/unread", support.PlatformDeskUnreadView.as_view()),
    path("chats/<uuid:pk>", support.PlatformDeskChatDetailView.as_view()),
    path("chats/<uuid:pk>/messages", support.PlatformDeskChatMessageView.as_view()),
    path("chats/<uuid:pk>/close", support.PlatformDeskChatCloseView.as_view()),
]
