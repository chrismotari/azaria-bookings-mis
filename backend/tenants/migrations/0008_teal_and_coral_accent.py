from django.db import migrations


def lighten_coral(apps, schema_editor):
    """Teal & Coral's accent passes the accent-on-bar rule (3:1 on the teal); only if it was never edited."""
    Theme = apps.get_model("tenants", "Theme")
    Theme.objects.filter(name="Teal & Coral", primary="#00676b", accent="#ff8a65", bar="").update(accent="#ff9a7a")


class Migration(migrations.Migration):
    dependencies = [("tenants", "0007_theme_bar_and_text_colours")]

    operations = [migrations.RunPython(lighten_coral, migrations.RunPython.noop)]
