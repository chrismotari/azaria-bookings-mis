# Renames the Offering model to Offer in place: the table, its rows and every
# foreign key to it are kept (no drop and re-create).
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0002_offering"),
        ("bookings", "0002_boardingpass"),
        ("requests", "0001_initial"),
    ]

    operations = [
        migrations.RenameModel("Offering", "Offer"),
    ]
