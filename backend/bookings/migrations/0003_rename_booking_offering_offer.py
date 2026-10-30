from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("bookings", "0002_boardingpass"),
        ("catalog", "0003_rename_offering_offer"),
    ]

    operations = [
        migrations.RenameField("booking", "offering", "offer"),
    ]
