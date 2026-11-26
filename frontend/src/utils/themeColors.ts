import type { ThemeColors } from '../theme';

/**
 * A theme's colours from the ones the owner chooses, and its contrast checks, for the live preview while the owner edits
 * a theme. The same rules as the server's (backend/tenants/themes.py), which checks every save again.
 */

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const WHITE = '#ffffff';
const DARK_TEXT = '#252525';
const BACKGROUND = '#f2f4f7';
export const MIN_CONTRAST = 4.5;
/** Accent buttons on the bar need this much contrast with it. */
export const MIN_ACCENT_ON_BAR = 3;
const TINT_AMOUNT = 0.09;
const HOVER_WHITE = 0.12;
const HOVER_DARK = 0.1;

function rgb(color: string): number[] {
  return [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16));
}

/** color at `amount` (0–1) opacity over `over`, as #rrggbb. */
function blend(color: string, amount: number, over = WHITE): string {
  const top = rgb(color);
  const bottom = rgb(over);
  return `#${top
    .map((value, index) => Math.floor(bottom[index] + (value - bottom[index]) * amount + 0.5))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

function luminance(color: string): number {
  const [red, green, blue] = rgb(color).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Rounded down, so a ratio shown as 4.5:1 always passes. */
export function ratioLabel(ratio: number): string {
  return `${(Math.floor(ratio * 10) / 10).toFixed(1)}:1`;
}

/** Whether a text colour is light (white-ish) rather than dark. */
export function isLightColor(color: string): boolean {
  return contrast(color, '#000000') > contrast(color, WHITE);
}

/** The hover shade of a filled colour: lighter under light text, darker under dark text. */
function hover(color: string, text: string): string {
  return isLightColor(text) ? blend(WHITE, HOVER_WHITE, color) : blend(DARK_TEXT, HOVER_DARK, color);
}

function autoText(color: string): string {
  return contrast(WHITE, color) >= MIN_CONTRAST ? WHITE : DARK_TEXT;
}

/** The colours an owner chooses; the optional ones are blank for automatic. */
export type ThemeChoice = {
  primary: string;
  accent: string;
  bar: string;
  primary_text: string;
  bar_text: string;
  accent_text: string;
};

export function deriveThemeColors(choice: ThemeChoice): ThemeColors {
  const primary = choice.primary.toLowerCase();
  const primaryText = (choice.primary_text || WHITE).toLowerCase();
  const primaryHover = hover(primary, primaryText);
  const bar = choice.bar.toLowerCase();
  const barText = bar ? (choice.bar_text || autoText(bar)).toLowerCase() : primaryText;
  return {
    primary,
    primary_text: primaryText,
    primary_tint: blend(primary, TINT_AMOUNT),
    primary_hover: primaryHover,
    bar: bar || primary,
    bar_text: barText,
    bar_hover: bar ? hover(bar, barText) : primaryHover,
    accent: choice.accent.toLowerCase(),
    accent_text: (choice.accent_text || DARK_TEXT).toLowerCase(),
  };
}

export type ContrastCheck = { label: string; ratio: number; min: number; passes: boolean };

function textName(text: string): string {
  return text === WHITE ? 'White text' : text === DARK_TEXT ? 'Dark text' : 'The text colour';
}

/** The rules, for valid #rrggbb colours (the optional ones blank or valid). */
export function contrastChecks(choice: ThemeChoice): ContrastCheck[] {
  const c = deriveThemeColors(choice);
  const primaryText = textName(c.primary_text);
  const checks = [
    { label: `${primaryText} on the primary`, ratio: contrast(c.primary_text, c.primary) },
    { label: `${primaryText} on the primary's hover shade`, ratio: contrast(c.primary_text, c.primary_hover) },
    { label: 'The primary on its tint', ratio: contrast(c.primary, c.primary_tint) },
    { label: 'The primary on the page background', ratio: contrast(c.primary, BACKGROUND) },
  ];
  if (choice.bar) {
    checks.push(
      { label: 'Text on the bar colour', ratio: contrast(c.bar_text, c.bar) },
      { label: "Text on the bar colour's hover shade", ratio: contrast(c.bar_text, c.bar_hover) },
    );
  }
  checks.push({ label: `${textName(c.accent_text)} on the accent`, ratio: contrast(c.accent_text, c.accent) });
  const withMin = checks.map((check) => ({ ...check, min: MIN_CONTRAST }));
  withMin.push({
    label: choice.bar ? 'The accent on the bar colour' : 'The accent on the primary',
    ratio: contrast(c.accent, c.bar),
    min: MIN_ACCENT_ON_BAR,
  });
  return withMin.map((check) => ({ ...check, passes: check.ratio >= check.min }));
}
