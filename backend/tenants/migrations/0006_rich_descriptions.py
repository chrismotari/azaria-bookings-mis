from django.db import migrations


def to_rich_text(apps, schema_editor):
    """Existing plain-text descriptions become escaped paragraphs."""
    from tenants.richtext import from_plain_text

    Plan = apps.get_model("tenants", "Plan")
    for plan in Plan.objects.exclude(description=""):
        plan.description = from_plain_text(plan.description)
        plan.save(update_fields=["description"])


class Migration(migrations.Migration):
    dependencies = [("tenants", "0005_plan_tag")]

    operations = [migrations.RunPython(to_rich_text, migrations.RunPython.noop)]
