"""The agency's own mail server, shared by its admins' Settings and the owner's agency page (run in its schema)."""

from smtplib import SMTPException

from rest_framework import status
from rest_framework.response import Response

from .emails import send_email
from .models import MailServer
from .serializers import EMPTY_MAIL_SERVER, MailServerSerializer


def read():
    """The saved server, or the blank form with in_use false."""
    server = MailServer.current()
    return MailServerSerializer(server).data if server else EMPTY_MAIL_SERVER


def status_of():
    """The short status the owner's agency list and page show."""
    server = MailServer.current()
    if server is None:
        return {"in_use": False, "last_failure_at": None, "last_failure": ""}
    return {"in_use": True, "last_failure_at": server.last_failure_at, "last_failure": server.last_failure}


def save(data):
    serializer = MailServerSerializer(MailServer.current(), data=data)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data)


def remove():
    MailServer.objects.all().delete()
    return Response(EMPTY_MAIL_SERVER)


def send_test(to):
    """Sends the test email at once through the saved server; the result (and its record) as the send went."""
    server = MailServer.current()
    if server is None:
        return Response({"detail": "Save the mail server first."}, status=status.HTTP_409_CONFLICT)
    try:
        send_email("mail_test", "Test email", to, {"host": server.host})
    except (SMTPException, OSError) as exc:
        return Response({"sent": False, "error": (str(exc) or type(exc).__name__)[:500]})
    return Response({"sent": True, "error": ""})
