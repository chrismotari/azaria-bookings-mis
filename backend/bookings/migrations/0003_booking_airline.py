import django.db.models.deletion
from django.db import migrations, models


def copy_from_offers(apps, schema_editor):
    """Existing bookings take their offer's ticketing airline."""
    Booking = apps.get_model("bookings", "Booking")
    for booking in Booking.objects.filter(airline__isnull=True).select_related("offer"):
        booking.airline_id = booking.offer.airline_id
        booking.save(update_fields=["airline"])
    # Checks the new foreign keys now, so the column can be made non-null in the same transaction.
    schema_editor.execute("SET CONSTRAINTS ALL IMMEDIATE")


class Migration(migrations.Migration):

    dependencies = [
        ('airlines', '0001_initial'),
        ('bookings', '0002_booking_fare_source'),
    ]

    operations = [
        migrations.AddField(
            model_name='booking',
            name='airline',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, related_name='+', to='airlines.airline'),
        ),
        migrations.RunPython(copy_from_offers, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='booking',
            name='airline',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='+', to='airlines.airline'),
        ),
    ]
