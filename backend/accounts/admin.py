from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from config.admin_site import platform_site

from .models import User


# On tenant hosts the tenant's users; on the root host the system owner's accounts.
@admin.register(User)
@admin.register(User, site=platform_site)
class UserAdmin(BaseUserAdmin):
    ordering = ["email"]
    list_display = ["email", "full_name", "role", "is_active", "is_superuser"]
    list_filter = ["role", "is_active", "is_superuser"]
    search_fields = ["email", "full_name", "phone"]
    fieldsets = [
        (None, {"fields": ["email", "password"]}),
        ("Profile", {"fields": ["full_name", "phone", "role"]}),
        ("Access", {"fields": ["is_active", "is_staff", "is_superuser", "last_login"]}),
    ]
    add_fieldsets = [
        (None, {"classes": ["wide"], "fields": ["email", "full_name", "role", "password1", "password2"]}),
    ]
    readonly_fields = ["last_login"]
    filter_horizontal = []
