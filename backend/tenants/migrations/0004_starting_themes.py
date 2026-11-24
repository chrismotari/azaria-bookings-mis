from django.db import migrations

# Name, primary, accent; the first is the default (the colours before themes). All pass the contrast rules.
STARTING_THEMES = [
    ("Indigo & Amber", "#1800d2", "#ffb400"),
    ("Navy & Gold", "#1b3a6b", "#f2c14e"),
    ("Teal & Coral", "#00676b", "#ff8a65"),
    ("Forest & Lime", "#1e5631", "#a4de02"),
    ("Burgundy & Sand", "#7b1e3a", "#f4d58d"),
    ("Plum & Peach", "#5b2a86", "#ffb38a"),
    ("Charcoal & Sky", "#2b2d42", "#8ecae6"),
    ("Ocean & Sunflower", "#0057b8", "#ffd100"),
]


def create_themes(apps, schema_editor):
    """The starting themes, and the default for every existing agency (and the platform's own row)."""
    Theme = apps.get_model("tenants", "Theme")
    Tenant = apps.get_model("tenants", "Tenant")
    for index, (name, primary, accent) in enumerate(STARTING_THEMES):
        Theme.objects.create(name=name, primary=primary, accent=accent, is_default=index == 0)
    Tenant.objects.filter(theme__isnull=True).update(theme=Theme.objects.get(is_default=True))


class Migration(migrations.Migration):
    dependencies = [("tenants", "0003_theme")]

    operations = [migrations.RunPython(create_themes, migrations.RunPython.noop)]
