import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("tenants", "0002_initial_rows")]

    operations = [
        migrations.CreateModel(
            name="Theme",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=40, unique=True)),
                ("primary", models.CharField(max_length=7)),
                ("accent", models.CharField(max_length=7)),
                ("is_active", models.BooleanField(default=True)),
                ("is_default", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "ordering": ["name"],
                "constraints": [
                    models.UniqueConstraint(
                        condition=models.Q(("is_default", True)), fields=("is_default",), name="one_default_theme"
                    )
                ],
            },
        ),
        # Nullable until 0004 gives every agency the default; 0005 makes it required.
        migrations.AddField(
            model_name="tenant",
            name="theme",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="tenants", to="tenants.theme"
            ),
        ),
    ]
