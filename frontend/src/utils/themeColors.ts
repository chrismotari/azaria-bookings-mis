import type { ThemeColors } from '../theme';

/**
 * A theme's colours from its primary and accent, and its contrast checks, for the live preview while the owner edits
 * a theme. The same rules as the server's (backend/tenants/themes.py), which checks every save again.
 */

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const WHITE = '#ffffff';
const DARK_TEXT = '#252525';
const BACKGROUND = '#f2f4f7';
export const MIN_CONTRAST = 4.5;
const TINT_AMOUNT = 0.09;
const HOVER_WHITE = 0.12;

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

export function deriveThemeColors(primary: string, accent: string): ThemeColors {
  const p = primary.toLowerCase();
  return {
    primary: p,
    primary_text: WHITE,
    primary_tint: blend(p, TINT_AMOUNT),
    primary_hover: blend(WHITE, HOVER_WHITE, p),
    accent: accent.toLowerCase(),
    accent_text: DARK_TEXT,
  };
}

export type ContrastCheck = { label: string; ratio: number; passes: boolean };

/** The five rules, for valid #rrggbb colours. */
export function contrastChecks(primary: string, accent: string): ContrastCheck[] {
  const colors = deriveThemeColors(primary, accent);
  return [
    { label: 'White text on the primary', ratio: contrast(WHITE, colors.primary) },
    { label: "White text on the primary's hover shade", ratio: contrast(WHITE, colors.primary_hover) },
    { label: 'The primary on its tint', ratio: contrast(colors.primary, colors.primary_tint) },
    { label: 'The primary on the page background', ratio: contrast(colors.primary, BACKGROUND) },
    { label: 'Dark text on the accent', ratio: contrast(DARK_TEXT, colors.accent) },
  ].map((check) => ({ ...check, passes: check.ratio >= MIN_CONTRAST }));
}
