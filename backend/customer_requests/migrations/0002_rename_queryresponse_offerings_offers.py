from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("requests", "0001_initial"),
        ("catalog", "0003_rename_offering_offer"),
    ]

    operations = [
        migrations.RenameField("queryresponse", "offerings", "offers"),
    ]
