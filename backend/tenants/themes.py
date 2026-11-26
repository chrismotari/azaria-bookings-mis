"""Agency themes: the colours a theme derives from its chosen colours, and the contrast rules every theme passes.

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
# With dark text on a colour, the hover shade goes darker instead: dark text at 10% over it.
HOVER_DARK = 0.10


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


def _light(color):
    """Whether a text colour is light (white-ish) rather than dark."""
    return contrast(color, "#000000") > contrast(color, WHITE)


def hover(color, text):
    """The hover shade of a filled colour: lighter under light text, darker under dark text."""
    return blend(WHITE, HOVER_WHITE, over=color) if _light(text) else blend(DARK_TEXT, HOVER_DARK, over=color)


def auto_text(color):
    """White when it is readable on the colour, dark text otherwise."""
    return WHITE if contrast(WHITE, color) >= MIN_CONTRAST else DARK_TEXT


def derived_colors(primary, accent, bar="", primary_text="", bar_text="", accent_text=""):
    """Everything the app and the emails need from a theme's colours; blank ones are automatic."""
    primary, accent = primary.lower(), accent.lower()
    primary_text = (primary_text or WHITE).lower()
    primary_hover = hover(primary, primary_text)
    if bar:
        bar = bar.lower()
        bar_text = (bar_text or auto_text(bar)).lower()
        bar_hover = hover(bar, bar_text)
    else:
        bar, bar_text, bar_hover = primary, primary_text, primary_hover
    return {
        "primary": primary,
        "primary_text": primary_text,
        "primary_tint": blend(primary, TINT_AMOUNT),
        "primary_hover": primary_hover,
        "bar": bar,
        "bar_text": bar_text,
        "bar_hover": bar_hover,
        "accent": accent,
        "accent_text": (accent_text or DARK_TEXT).lower(),
    }


def _text_name(text):
    return {WHITE: "White text", DARK_TEXT: "Dark text"}.get(text, "This text colour")


def _failing(checks):
    return [
        f"{label} is {ratio_label(ratio)}; it needs {MIN_CONTRAST}:1."
        for label, ratio in checks
        if ratio < MIN_CONTRAST
    ]


def primary_text_problems(primary, text=WHITE):
    """The rules between the primary and its text colour."""
    primary, text = primary.lower(), text.lower()
    name = _text_name(text)
    return _failing(
        [
            (f"{name} on this primary", contrast(text, primary)),
            (f"{name} on this primary's hover shade", contrast(text, hover(primary, text))),
        ]
    )


def primary_surface_problems(primary):
    """The rules between the primary and the light surfaces it sits on as text."""
    primary = primary.lower()
    return _failing(
        [
            ("This primary on its tint", contrast(primary, blend(primary, TINT_AMOUNT))),
            ("This primary on the page background", contrast(primary, BACKGROUND)),
        ]
    )


def primary_problems(primary, text=WHITE):
    """The primary's failing contrast rules, as messages for the user."""
    return primary_text_problems(primary, text) + primary_surface_problems(primary)


def bar_problems(bar, text=""):
    """The rules between a bar colour and its text colour (automatic when blank)."""
    bar = bar.lower()
    text = (text or auto_text(bar)).lower()
    return _failing(
        [
            ("Text on this bar colour", contrast(text, bar)),
            ("Text on this bar colour's hover shade", contrast(text, hover(bar, text))),
        ]
    )


def accent_problems(accent, text=DARK_TEXT):
    text = text.lower()
    return _failing([(f"{_text_name(text)} on this accent", contrast(text, accent.lower()))])
