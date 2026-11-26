"""Agency themes: the colours a theme derives from its primary and accent, and the contrast rules every theme passes.

The app (frontend/src/theme.ts) derives and checks the same way for its live preview; the server is the judge.
"""

import math
import re

HEX = re.compile(r"^#[0-9a-fA-F]{6}$")

WHITE = "#ffffff"
# Text on the accent, and the page background the primary sits on (the same in every theme).
DARK_TEXT = "#252525"
BACKGROUND = "#f2f4f7"
MIN_CONTRAST = 4.5
# The tint is the primary blended this much over white; the hover shade is the primary with this much white over it
# (what the bar's hover looked like before themes: white at 12% over the primary).
TINT_AMOUNT = 0.09
HOVER_WHITE = 0.12


def _rgb(color):
    return [int(color[i : i + 2], 16) for i in (1, 3, 5)]


def blend(color, amount, over=WHITE):
    """color at `amount` (0–1) opacity over `over`, as #rrggbb."""
    top, bottom = _rgb(color), _rgb(over)
    # Half up, as the app's Math.round does.
    return "#" + "".join(f"{math.floor(b + (t - b) * amount + 0.5):02x}" for t, b in zip(top, bottom, strict=True))


def _luminance(color):
    def channel(value):
        value /= 255
        return value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4

    red, green, blue = (channel(value) for value in _rgb(color))
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def contrast(first, second):
    """The WCAG contrast ratio of two colours (1 to 21)."""
    lighter, darker = sorted([_luminance(first), _luminance(second)], reverse=True)
    return (lighter + 0.05) / (darker + 0.05)


def ratio_label(ratio):
    """Rounded down, so a ratio shown as 4.5:1 always passes."""
    return f"{math.floor(ratio * 10) / 10:.1f}:1"


def derived_colors(primary, accent):
    """Everything the app and the emails need from a theme's two colours."""
    primary, accent = primary.lower(), accent.lower()
    return {
        "primary": primary,
        "primary_text": WHITE,
        "primary_tint": blend(primary, TINT_AMOUNT),
        "primary_hover": blend(WHITE, HOVER_WHITE, over=primary),
        "accent": accent,
        "accent_text": DARK_TEXT,
    }


def primary_problems(primary):
    """The primary's failing contrast rules, as messages for the user."""
    primary = primary.lower()
    checks = [
        ("White text on this primary", contrast(WHITE, primary)),
        ("White text on this primary's hover shade", contrast(WHITE, blend(WHITE, HOVER_WHITE, over=primary))),
        ("This primary on its tint", contrast(primary, blend(primary, TINT_AMOUNT))),
        ("This primary on the page background", contrast(primary, BACKGROUND)),
    ]
    return [
        f"{label} is {ratio_label(ratio)}; it needs {MIN_CONTRAST}:1."
        for label, ratio in checks
        if ratio < MIN_CONTRAST
    ]


def accent_problems(accent):
    ratio = contrast(DARK_TEXT, accent.lower())
    if ratio < MIN_CONTRAST:
        return [f"Dark text on this accent is {ratio_label(ratio)}; it needs {MIN_CONTRAST}:1."]
    return []
