import uuid

import django_filters
from django.db.models import Count, Q
from rest_framework import generics, status
from rest_framework.exceptions import NotAuthenticated, PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsAdminRole

from . import services
from .models import Review, rating
from .serializers import (
    REVIEW_RELATED,
    AdminReviewSerializer,
    OwnReviewSerializer,
    PublicReviewSerializer,
    ReplySerializer,
    ReviewChangeSerializer,
    ReviewCreateSerializer,
)

Kind = Review.Kind


class PublicPagination(PageNumberPagination):
    page_size = 10


def public_scope(params):
    """The reviews of exactly one of tour, hotel or kind=flight, as a filter and its kind."""
    given = {name: params[name] for name in ("tour", "hotel", "kind") if params.get(name)}
    if len(given) != 1 or given.get("kind", Kind.FLIGHT) != Kind.FLIGHT:
        raise ValidationError({"detail": "Choose exactly one of tour, hotel or kind=flight."})
    if "kind" in given:
        return Q(kind=Kind.FLIGHT), Kind.FLIGHT
    name, value = next(iter(given.items()))
    try:
        uuid.UUID(value)
    except ValueError:
        raise ValidationError({name: ["Not a valid id."]}) from None
    return Q(**{name: value}), Kind.TOUR if name == "tour" else Kind.HOTEL


class ReviewListView(APIView):
    """GET with tour, hotel or kind=flight: the public reviews and their summary; without: the customer's own.
    POST: the customer reviews one of their bookings."""

    permission_classes = [AllowAny]

    def get(self, request):
        params = request.query_params
        if any(params.get(name) for name in ("tour", "hotel", "kind")):
            return self.public(request)
        if not request.user.is_authenticated:
            raise NotAuthenticated()
        reviews = Review.objects.filter(user=request.user, kind__in=services.kinds_on()).select_related(*REVIEW_RELATED)
        paginator = PageNumberPagination()
        page = paginator.paginate_queryset(reviews, request, view=self)
        return paginator.get_paginated_response(OwnReviewSerializer(page, many=True).data)

    def public(self, request):
        scope, kind = public_scope(request.query_params)
        services.require_module(kind)
        reviews = Review.objects.filter(scope)
        by_rating = {str(stars): 0 for stars in range(1, 6)}
        for row in reviews.order_by().values("rating").annotate(count=Count("pk")):
            by_rating[str(row["rating"])] = row["count"]
        figures = rating(reviews)
        summary = {**(figures or {"average": None, "count": 0}), "by_rating": by_rating}
        paginator = PublicPagination()
        page = paginator.paginate_queryset(reviews.filter(is_hidden=False).select_related("user"), request, view=self)
        response = paginator.get_paginated_response(PublicReviewSerializer(page, many=True).data)
        response.data["summary"] = summary
        return response

    def post(self, request):
        if not request.user.is_authenticated:
            raise NotAuthenticated()
        if request.user.role != request.user.Role.CUSTOMER:
            raise PermissionDenied("Only customers can review.")
        serializer = ReviewCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        review = services.create_review(request.user, data["kind"], data["booking_id"], data["rating"], data["comment"])
        review = Review.objects.select_related(*REVIEW_RELATED).get(pk=review.pk)
        return Response(OwnReviewSerializer(review).data, status=status.HTTP_201_CREATED)


class ReviewDetailView(APIView):
    """PATCH rating and comment, or DELETE: the author's own review."""

    def review(self, request, pk):
        return generics.get_object_or_404(Review.objects.select_related(*REVIEW_RELATED), pk=pk, user=request.user)

    def patch(self, request, pk):
        review = self.review(request, pk)
        serializer = ReviewChangeSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        services.change_review(review, serializer.validated_data)
        return Response(OwnReviewSerializer(review).data)

    def delete(self, request, pk):
        services.delete_review(self.review(request, pk))
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminReviewFilter(django_filters.FilterSet):
    hidden = django_filters.BooleanFilter(field_name="is_hidden")
    replied = django_filters.BooleanFilter(method="filter_replied")

    class Meta:
        model = Review
        fields = ["kind", "tour", "hotel", "rating"]

    def filter_replied(self, queryset, name, value):
        return queryset.exclude(reply="") if value else queryset.filter(reply="")


class AdminReviewListView(generics.ListAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = AdminReviewSerializer
    filterset_class = AdminReviewFilter

    def get_queryset(self):
        params = self.request.query_params
        for name, kind in (("kind", params.get("kind")), ("tour", Kind.TOUR), ("hotel", Kind.HOTEL)):
            if params.get(name) and kind in Kind.values:
                services.require_module(kind)
        return Review.objects.filter(kind__in=services.kinds_on()).select_related(
            *REVIEW_RELATED, "hidden_by", "replied_by"
        )


class AdminReviewView(APIView):
    permission_classes = [IsAdminRole]

    def review(self, pk):
        review = generics.get_object_or_404(
            Review.objects.select_related(*REVIEW_RELATED, "hidden_by", "replied_by"), pk=pk
        )
        services.require_module(review.kind)
        return review

    def get(self, request, pk):
        return Response(AdminReviewSerializer(self.review(pk)).data)


class AdminReviewActionView(AdminReviewView):
    """POST hide, show or reply {reply}; the URL conf sets action."""

    http_method_names = ["post", "options"]
    action = None

    def post(self, request, pk):
        review = self.review(pk)
        if self.action == "reply":
            serializer = ReplySerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            services.set_reply(review, request.user, serializer.validated_data["reply"])
        else:
            services.set_hidden(review, request.user, self.action == "hide")
        return Response(AdminReviewSerializer(self.review(pk)).data)
