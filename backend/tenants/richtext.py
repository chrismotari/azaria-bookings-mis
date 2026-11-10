"""Plan descriptions are rich text: sanitized HTML with a small set of tags (step 30)."""

import html

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


def from_plain_text(text):
    """Plain text as escaped paragraphs (one per blank-line block, line breaks kept)."""
    blocks = [block.strip() for block in (text or "").replace("\r\n", "\n").split("\n\n")]
    return "".join(f"<p>{html.escape(block).replace(chr(10), '<br>')}</p>" for block in blocks if block)
