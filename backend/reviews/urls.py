from django.urls import path

from . import views

urlpatterns = [
    path("reviews", views.ReviewListView.as_view()),
    path("reviews/<uuid:pk>", views.ReviewDetailView.as_view()),
    path("admin/reviews", views.AdminReviewListView.as_view()),
    path("admin/reviews/<uuid:pk>", views.AdminReviewView.as_view()),
    path("admin/reviews/<uuid:pk>/hide", views.AdminReviewActionView.as_view(action="hide")),
    path("admin/reviews/<uuid:pk>/show", views.AdminReviewActionView.as_view(action="show")),
    path("admin/reviews/<uuid:pk>/reply", views.AdminReviewActionView.as_view(action="reply")),
]
