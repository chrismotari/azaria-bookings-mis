from django.db import transaction
from django.db.models import Prefetch
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import Offer
from core.permissions import IsAdminRole

from .models import Query, QueryResponse
from .serializers import (
    AdminQueryDetailSerializer,
    AdminQuerySerializer,
    QueryDetailSerializer,
    QuerySerializer,
    RespondSerializer,
)
from .services import close_query, respond_to_query
from .tasks import notify_admin_new_query


def with_responses(queryset):
    offers = Offer.objects.select_related("origin", "destination")
    responses = QueryResponse.objects.prefetch_related(Prefetch("offers", queryset=offers))
    return queryset.prefetch_related(Prefetch("responses", queryset=responses))


class QueryListCreateView(generics.ListCreateAPIView):
    serializer_class = QuerySerializer

    def get_queryset(self):
        return Query.objects.filter(user=self.request.user).select_related("origin", "destination")

    def perform_create(self, serializer):
        query = serializer.save(user=self.request.user)
        transaction.on_commit(lambda: notify_admin_new_query.delay(query.pk))


class QueryDetailView(generics.RetrieveAPIView):
    serializer_class = QueryDetailSerializer

    def get_queryset(self):
        return with_responses(Query.objects.filter(user=self.request.user).select_related("origin", "destination"))


class QueryCloseView(APIView):
    def post(self, request, pk):
        generics.get_object_or_404(Query, pk=pk, user=request.user)
        close_query(pk, request.user)
        query = with_responses(Query.objects.select_related("origin", "destination")).get(pk=pk)
        return Response(QueryDetailSerializer(query).data)


class AdminQueryListView(generics.ListAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = AdminQuerySerializer
    queryset = Query.objects.select_related("user", "origin", "destination")
    filterset_fields = ["status"]


class AdminQueryDetailView(generics.RetrieveAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = AdminQueryDetailSerializer
    queryset = with_responses(Query.objects.select_related("user", "origin", "destination"))


class AdminQueryRespondView(APIView):
    permission_classes = [IsAdminRole]

    def post(self, request, pk):
        generics.get_object_or_404(Query, pk=pk)
        serializer = RespondSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        respond_to_query(pk, data["message"], data["offer_ids"], data["new_offers"])
        query = with_responses(Query.objects.select_related("user", "origin", "destination")).get(pk=pk)
        return Response(AdminQueryDetailSerializer(query).data, status=status.HTTP_201_CREATED)
