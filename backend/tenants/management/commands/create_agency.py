from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from tenants.services import create_agency, domain_for


class Command(BaseCommand):
    help = "Create an agency (tenant): its schema, primary domain, settings and first admin."

    def add_arguments(self, parser):
        parser.add_argument("--schema", required=True, help="The address, e.g. azaria (reached at azaria.<base domain>).")
        parser.add_argument("--name", required=True)
        parser.add_argument("--admin-email", required=True)
        parser.add_argument("--admin-password", required=True)
        parser.add_argument("--admin-name", required=True)

    def handle(self, *args, **options):
        try:
            tenant = create_agency(
                slug=options["schema"],
                name=options["name"],
                admin_email=options["admin_email"],
                admin_password=options["admin_password"],
                admin_name=options["admin_name"],
            )
        except ValidationError as exc:
            raise CommandError(" ".join(exc.messages))
        self.stdout.write(self.style.SUCCESS(f"Agency {tenant.name} created at {domain_for(options['schema'])}."))
