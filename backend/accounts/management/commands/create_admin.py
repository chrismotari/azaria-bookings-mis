from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from accounts.models import User


class Command(BaseCommand):
    help = "Create the agency owner's admin account (role 'admin')."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--password", required=True)
        parser.add_argument("--name", required=True)

    def handle(self, *args, email, password, name, **options):
        email = User.objects.normalize_email(email)
        if User.objects.filter(email=email).exists():
            raise CommandError(f"A user with email {email} already exists.")
        try:
            password_validation.validate_password(password, User(email=email, full_name=name))
        except ValidationError as exc:
            raise CommandError(" ".join(exc.messages))
        User.objects.create_user(email=email, password=password, full_name=name, role=User.Role.ADMIN)
        self.stdout.write(self.style.SUCCESS(f"Admin {email} created."))
