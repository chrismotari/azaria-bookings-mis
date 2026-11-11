from django.urls import path

from . import views

urlpatterns = [
    path("admin/users", views.AdminCustomerListView.as_view()),
    path("admin/users/<uuid:pk>", views.AdminCustomerDetailView.as_view()),
    path("admin/users/<uuid:pk>/make-admin", views.AdminCustomerMakeAdminView.as_view()),
]
