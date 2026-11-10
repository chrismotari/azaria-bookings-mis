from rest_framework import serializers

from core.files import check_upload

from .models import Conversation, Message


class MessageSerializer(serializers.ModelSerializer):
    has_attachment = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = ["id", "from_staff", "author_name", "body", "has_attachment", "attachment_name", "created_at"]
        read_only_fields = fields

    def get_has_attachment(self, message):
        return bool(message.attachment)


class ConversationSerializer(serializers.ModelSerializer):
    """A chat as its requester sees it."""

    unread = serializers.BooleanField(source="requester_unread", read_only=True)

    class Meta:
        model = Conversation
        fields = ["id", "subject", "email", "status", "last_message_at", "unread", "closed_at", "created_at"]
        read_only_fields = fields


class ConversationDetailSerializer(ConversationSerializer):
    messages = MessageSerializer(many=True, read_only=True)

    class Meta(ConversationSerializer.Meta):
        fields = [*ConversationSerializer.Meta.fields, "messages"]
        read_only_fields = fields


class DeskConversationSerializer(serializers.ModelSerializer):
    """A chat as the desk sees it."""

    unread = serializers.BooleanField(source="staff_unread", read_only=True)
    is_guest = serializers.BooleanField(read_only=True)
    closed_by_name = serializers.SerializerMethodField()
    # Platform desk: the agency an agency admin wrote from; null for visitors and on an agency's desk.
    agency = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = [
            "id",
            "subject",
            "email",
            "name",
            "is_guest",
            "status",
            "last_message_at",
            "unread",
            "closed_at",
            "closed_by_name",
            "agency",
            "created_at",
        ]
        read_only_fields = fields

    def get_agency(self, conversation):
        return {"id": conversation.agency_id, "name": conversation.agency.name} if conversation.agency_id else None

    def get_closed_by_name(self, conversation):
        return conversation.closed_by.full_name if conversation.closed_by else None


class DeskConversationDetailSerializer(DeskConversationSerializer):
    messages = MessageSerializer(many=True, read_only=True)

    class Meta(DeskConversationSerializer.Meta):
        fields = [*DeskConversationSerializer.Meta.fields, "messages"]
        read_only_fields = fields


class MessageInputSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=5000)
    attachment = serializers.FileField(max_length=255, required=False, allow_null=True)

    def validate_body(self, value):
        if not value.strip():
            raise serializers.ValidationError("Write a message.")
        return value.strip()

    def validate_attachment(self, file):
        return check_upload(file) if file else None


class StartChatSerializer(MessageInputSerializer):
    email = serializers.EmailField()
    subject = serializers.CharField(max_length=150)

    def validate_subject(self, value):
        if not value.strip():
            raise serializers.ValidationError("Enter a subject.")
        return value.strip()
