from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('integrations', '0003_searchrun_recheck'),
    ]

    operations = [
        migrations.AlterField(
            model_name='integration',
            name='provider',
            field=models.CharField(choices=[('duffel', 'Duffel'), ('travelport', 'Travelport')], max_length=20),
        ),
    ]
