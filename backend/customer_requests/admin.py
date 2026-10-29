from django.contrib import admin

from .models import Query, QueryResponse


@admin.register(Query)
class QueryAdmin(admin.ModelAdmin):
    list_display = ["__str__", "user", "status", "created_at"]
    list_filter = ["status"]
    raw_id_fields = ["user", "origin", "destination"]


@admin.register(QueryResponse)
class QueryResponseAdmin(admin.ModelAdmin):
    list_display = ["__str__", "created_at"]
    raw_id_fields = ["query", "offerings"]
