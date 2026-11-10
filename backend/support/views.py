"""Support chat API. The agency desk's views (step 31); the platform desk reuses them with its own permission."""

import mimetypes

from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import FileResponse, Http404
from django.db import connection
from django.shortcuts import get_object_or_404
from django_tenants.utils import get_public_schema_name, schema_context
from rest_framework import generics, status
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsAdminRole
from core.throttling import IPScopedRateThrottle
from tenants.permissions import IsPlatformOwner

from . import services
from .models import Conversation, Message
from .serializers import (
    ConversationDetailSerializer,
    ConversationSerializer,
    DeskConversationDetailSerializer,
    DeskConversationSerializer,
    MessageInputSerializer,
    StartChatSerializer,
)

PARSERS = [MultiPartParser, FormParser, JSONParser]


class ChatClosed(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "chat_closed"


def write(conversation, data, *, from_staff, author_name):
    try:
        return services.write(
            conversation,
            body=data["body"],
            attachment=data.get("attachment"),
            from_staff=from_staff,
            author_name=author_name,
        )
    except DjangoValidationError as exc:
        raise ChatClosed(exc.messages[0])


class GuestChatThrottle(IPScopedRateThrottle):
    """New chats from guests only (the view's throttle_scope); signed-in requesters are not throttled."""

    def allow_request(self, request, view):
        if request.user and request.user.is_authenticated:
            return True
        return super().allow_request(request, view)


# The requester's side


def my_chats(request):
    return Conversation.objects.filter(requester=request.user.pk)


class ChatsView(generics.ListAPIView):
    """GET: the signed-in requester's chats (?status=open for the message button). POST: a new chat with this
    host's desk, from a guest or a signed-in requester, never from whoever answers the desk."""

    serializer_class = ConversationSerializer
    parser_classes = PARSERS
    throttle_classes = [GuestChatThrottle]
    throttle_scope = "support_guest"
    desk_permission = IsAdminRole

    def get_permissions(self):
        return [AllowAny()] if self.request.method == "POST" else [IsAuthenticated()]

    def get_throttles(self):
        return super().get_throttles() if self.request.method == "POST" else []

    def get_queryset(self):
        chats = my_chats(self.request)
        wanted = self.request.query_params.get("status")
        return chats.filter(status=wanted) if wanted in Conversation.Status.values else chats

    def post(self, request):
        user = request.user if request.user.is_authenticated else None
        if user and self.desk_permission().has_permission(request, self):
            raise PermissionDenied("You answer this desk's chats; you cannot start one here.")
        serializer = StartChatSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        conversation = services.start_chat(
            email=data["email"], subject=data["subject"], body=data["body"], attachment=data.get("attachment"), user=user
        )
        if user is None:
            # A guest's chat is a single message: nothing to read back.
            return Response({"email": conversation.email}, status=status.HTTP_201_CREATED)
        conversation = Conversation.objects.prefetch_related("messages").get(pk=conversation.pk)
        return Response(ConversationDetailSerializer(conversation).data, status=status.HTTP_201_CREATED)


class MyChatDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        conversation = get_object_or_404(my_chats(request).prefetch_related("messages"), pk=pk)
        services.mark_read(conversation, by_staff=False)
        return Response(ConversationDetailSerializer(conversation).data)


class MyChatMessageView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = PARSERS

    def post(self, request, pk):
        conversation = get_object_or_404(my_chats(request), pk=pk)
        serializer = MessageInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        write(conversation, serializer.validated_data, from_staff=False, author_name=request.user.full_name)
        conversation = Conversation.objects.prefetch_related("messages").get(pk=pk)
        return Response(ConversationDetailSerializer(conversation).data, status=status.HTTP_201_CREATED)


class MyUnreadView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        count = my_chats(request).filter(status=Conversation.Status.OPEN, requester_unread=True).count()
        return Response({"count": count})


# The desk's side


class DeskView:
    permission_classes = [IsAdminRole]


class DeskChatListView(DeskView, generics.ListAPIView):
    serializer_class = DeskConversationSerializer

    def get_queryset(self):
        wanted = self.request.query_params.get("status", Conversation.Status.OPEN)
        chats = Conversation.objects.select_related("closed_by", "agency").order_by("-staff_unread", "-last_message_at")
        return chats.filter(status=wanted) if wanted in Conversation.Status.values else chats


class DeskChatDetailView(DeskView, APIView):
    def get(self, request, pk):
        conversation = get_object_or_404(Conversation.objects.select_related("agency").prefetch_related("messages"), pk=pk)
        services.mark_read(conversation, by_staff=True)
        return Response(DeskConversationDetailSerializer(conversation).data)


class DeskChatMessageView(DeskView, APIView):
    parser_classes = PARSERS

    def post(self, request, pk):
        conversation = get_object_or_404(Conversation, pk=pk)
        serializer = MessageInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        write(conversation, serializer.validated_data, from_staff=True, author_name=request.user.full_name)
        conversation = Conversation.objects.prefetch_related("messages").get(pk=pk)
        return Response(DeskConversationDetailSerializer(conversation).data, status=status.HTTP_201_CREATED)


class DeskChatCloseView(DeskView, APIView):
    def post(self, request, pk):
        conversation = services.close(get_object_or_404(Conversation, pk=pk), request.user)
        conversation = Conversation.objects.prefetch_related("messages").get(pk=conversation.pk)
        return Response(DeskConversationDetailSerializer(conversation).data)


class DeskUnreadView(DeskView, APIView):
    def get(self, request):
        count = Conversation.objects.filter(status=Conversation.Status.OPEN, staff_unread=True).count()
        return Response({"count": count})


class AttachmentView(APIView):
    """A message's attachment: for the desk, and for the requester of a signed-in chat."""

    permission_classes = [IsAuthenticated]
    desk_permission = IsAdminRole

    def get(self, request, pk):
        message = get_object_or_404(Message.objects.select_related("conversation"), pk=pk)
        is_desk = self.desk_permission().has_permission(request, self)
        if not message.attachment or not (is_desk or message.conversation.requester == request.user.pk):
            raise Http404
        content_type = mimetypes.guess_type(message.attachment_name)[0] or "application/octet-stream"
        return FileResponse(
            message.attachment.open("rb"),
            as_attachment=True,
            filename=message.attachment_name,
            content_type=content_type,
        )


# The platform's desk (root host): the same views, answered by the system owner.


class PlatformChatsView(ChatsView):
    desk_permission = IsPlatformOwner


class PlatformDeskView:
    permission_classes = [IsPlatformOwner]


class PlatformDeskChatListView(PlatformDeskView, DeskChatListView):
    pass


class PlatformDeskChatDetailView(PlatformDeskView, DeskChatDetailView):
    pass


class PlatformDeskChatMessageView(PlatformDeskView, DeskChatMessageView):
    pass


class PlatformDeskChatCloseView(PlatformDeskView, DeskChatCloseView):
    pass


class PlatformDeskUnreadView(PlatformDeskView, DeskUnreadView):
    pass


class PlatformAttachmentView(AttachmentView):
    desk_permission = IsPlatformOwner


# An agency's admins writing to the platform's desk, from their own host (step 32). Their chats live in the
# public schema with agency set to their agency.


def _agency():
    from tenants.models import Tenant

    return Tenant.objects.get(schema_name=connection.schema_name)


class PlatformChatsForAgencyView(generics.ListAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = ConversationSerializer
    parser_classes = PARSERS

    def list(self, request, *args, **kwargs):
        # Which agency this is, read before switching to the platform's schema.
        self.agency = _agency()
        with schema_context(get_public_schema_name()):
            return super().list(request, *args, **kwargs)

    def get_queryset(self):
        chats = Conversation.objects.filter(requester=self.request.user.pk, agency=self.agency)
        wanted = self.request.query_params.get("status")
        return chats.filter(status=wanted) if wanted in Conversation.Status.values else chats

    def post(self, request):
        serializer = StartChatSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        agency = _agency()
        with schema_context(get_public_schema_name()):
            conversation = services.start_chat(
                email=data["email"],
                subject=data["subject"],
                body=data["body"],
                attachment=data.get("attachment"),
                user=request.user,
                agency=agency,
            )
            conversation = Conversation.objects.prefetch_related("messages").get(pk=conversation.pk)
            return Response(ConversationDetailSerializer(conversation).data, status=status.HTTP_201_CREATED)


class PlatformChatForAgencyDetailView(APIView):
    permission_classes = [IsAdminRole]

    def get(self, request, pk):
        agency = _agency()
        with schema_context(get_public_schema_name()):
            chats = Conversation.objects.filter(requester=request.user.pk, agency=agency)
            conversation = get_object_or_404(chats.prefetch_related("messages"), pk=pk)
            services.mark_read(conversation, by_staff=False)
            return Response(ConversationDetailSerializer(conversation).data)


class PlatformChatForAgencyMessageView(APIView):
    permission_classes = [IsAdminRole]
    parser_classes = PARSERS

    def post(self, request, pk):
        serializer = MessageInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        agency = _agency()
        with schema_context(get_public_schema_name()):
            chats = Conversation.objects.filter(requester=request.user.pk, agency=agency)
            conversation = get_object_or_404(chats, pk=pk)
            write(conversation, serializer.validated_data, from_staff=False, author_name=request.user.full_name)
            conversation = Conversation.objects.prefetch_related("messages").get(pk=pk)
            return Response(ConversationDetailSerializer(conversation).data, status=status.HTTP_201_CREATED)


class PlatformChatForAgencyUnreadView(APIView):
    permission_classes = [IsAdminRole]

    def get(self, request):
        agency = _agency()
        with schema_context(get_public_schema_name()):
            chats = Conversation.objects.filter(requester=request.user.pk, agency=agency)
            return Response({"count": chats.filter(status=Conversation.Status.OPEN, requester_unread=True).count()})


class PlatformAttachmentForAgencyView(APIView):
    permission_classes = [IsAdminRole]

    def get(self, request, pk):
        agency = _agency()
        with schema_context(get_public_schema_name()):
            message = get_object_or_404(
                Message.objects.select_related("conversation"),
                pk=pk,
                conversation__requester=request.user.pk,
                conversation__agency=agency,
            )
            if not message.attachment:
                raise Http404
            content_type = mimetypes.guess_type(message.attachment_name)[0] or "application/octet-stream"
            return FileResponse(
                message.attachment.open("rb"),
                as_attachment=True,
                filename=message.attachment_name,
                content_type=content_type,
            )
