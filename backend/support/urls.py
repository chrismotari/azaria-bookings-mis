from django.urls import path

from . import views

urlpatterns = [
    path("support/chats", views.ChatsView.as_view()),
    path("support/chats/<uuid:pk>", views.MyChatDetailView.as_view()),
    path("support/chats/<uuid:pk>/messages", views.MyChatMessageView.as_view()),
    path("support/unread", views.MyUnreadView.as_view()),
    path("support/attachments/<uuid:pk>", views.AttachmentView.as_view()),
    path("admin/chats", views.DeskChatListView.as_view()),
    path("admin/chats/unread", views.DeskUnreadView.as_view()),
    path("admin/chats/<uuid:pk>", views.DeskChatDetailView.as_view()),
    path("admin/chats/<uuid:pk>/messages", views.DeskChatMessageView.as_view()),
    path("admin/chats/<uuid:pk>/close", views.DeskChatCloseView.as_view()),
]
