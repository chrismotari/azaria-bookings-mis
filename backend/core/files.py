"""Uploads the app accepts (boarding passes, chat attachments): PDF, PNG or JPEG up to 5 MB, content checked."""

import os

from rest_framework import serializers

MAX_SIZE = 5 * 1024 * 1024
# Allowed extension -> the content type it must be uploaded with.
CONTENT_TYPES = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}
# How each allowed content type's files begin.
FILE_SIGNATURES = {
    "application/pdf": b"%PDF-",
    "image/png": b"\x89PNG\r\n\x1a\n",
    "image/jpeg": b"\xff\xd8\xff",
}
ACCEPT = ",".join(CONTENT_TYPES)


def check_upload(file):
    """Raises a serializer ValidationError unless the file is an allowed type, its content matches, and it fits."""
    extension = os.path.splitext(file.name)[1].lower()
    content_type = CONTENT_TYPES.get(extension)
    if content_type is None or file.content_type != content_type:
        raise serializers.ValidationError("Upload a PDF, PNG or JPEG file.")
    signature = FILE_SIGNATURES[content_type]
    head = file.read(len(signature))
    file.seek(0)
    if head != signature:
        raise serializers.ValidationError("The file's content does not match its type.")
    if file.size > MAX_SIZE:
        raise serializers.ValidationError("The file is larger than 5 MB.")
    return file
