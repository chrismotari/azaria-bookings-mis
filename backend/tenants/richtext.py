"""Plan descriptions are rich text: sanitized HTML with a small set of tags."""

import nh3

TAGS = {"p", "br", "strong", "em", "u", "s", "h3", "h4", "ul", "ol", "li", "a"}
MAX_LENGTH = 5000


def sanitize(value):
    """Keeps only TAGS; links keep an http, https or mailto href and open in a new tab without the opener."""
    cleaned = nh3.clean(
        value or "",
        tags=TAGS,
        attributes={"a": {"href"}},
        url_schemes={"http", "https", "mailto"},
        link_rel="noopener noreferrer",
        set_tag_attribute_values={"a": {"target": "_blank"}},
    ).strip()
    # An editor's empty document.
    return "" if cleaned in ("<p></p>", "<p><br></p>") else cleaned

