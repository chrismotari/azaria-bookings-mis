import { useSyncExternalStore } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';

/** What a theme sets, as the API sends it (GET /agency, the theme lists). */
export type ThemeColors = {
  primary: string;
  primary_text: string;
  primary_tint: string;
  primary_hover: string;
  accent: string;
  accent_text: string;
};

/**
 * Azaria's own colours (from azariabookings.com, assets/css/sections/variables.css): wherever there is no agency
 * (the platform app, the web app's loading state, the mobile Find your agency screen). An agency's theme replaces
 * exactly these.
 */
const AZARIA = {
  primary: '#1800d2',
  primaryText: '#ffffff',
  primaryTint: '#ebe8fd',
  /** Hover on the primary bar. */
  primaryHover: 'rgba(255, 255, 255, 0.12)',
  accent: '#ffb400',
  accentText: '#252525',
};

/**
 * The app's colours. The six brand ones follow the agency's theme (applyTheme); the rest are the same everywhere.
 * Status text shades are darker than the brand status colours so text on their tints meets WCAG AA (4.5:1).
 * Read them while rendering, or in createStyles, never into a constant when a file loads: they change with the theme.
 */
export const colors = {
  ...AZARIA,
  tertiary: '#4a6660',
  text: '#252525',
  dark: '#2d3434',
  muted: '#6c7171',
  placeholder: '#8a9294',
  light: '#a8b1b5',
  border: '#dde2e5',
  background: '#f2f4f7',
  surface: '#ffffff',
  danger: '#c41a33',
  dangerText: '#b5162d',
  dangerTint: '#ffe8eb',
  success: '#1a7a3c',
  successText: '#17703a',
  successTint: '#e3f8ea',
  warningText: '#7a5200',
  warningTint: '#fff3d6',
  infoText: '#0b4fc0',
  infoTint: '#e6efff',
  neutralText: '#3d4545',
  neutralTint: '#eceff1',
  /** Dims the page behind a dialog. */
  overlay: 'rgba(37, 37, 37, 0.5)',
};

// Bumped whenever the colours change: styles rebuild, and the app below the theme re-mounts (App.tsx).
let themeVersion = 0;
const listeners = new Set<() => void>();

/** Applies an agency's theme, or Azaria's own colours with null. Nothing happens when the colours are the same. */
export function applyTheme(theme: ThemeColors | null) {
  const next = theme
    ? {
        primary: theme.primary,
        primaryText: theme.primary_text,
        primaryTint: theme.primary_tint,
        primaryHover: theme.primary_hover,
        accent: theme.accent,
        accentText: theme.accent_text,
      }
    : AZARIA;
  if ((Object.keys(next) as (keyof typeof next)[]).every((key) => colors[key] === next[key])) {
    return;
  }
  Object.assign(colors, next);
  themeVersion += 1;
  listeners.forEach((listener) => listener());
}

/** Calls listener after every theme change; returns the unsubscribe function. */
export function onThemeChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Changes whenever the theme does: the app keys its screens on it so they render again with the new colours. */
export function useThemeVersion(): number {
  return useSyncExternalStore(onThemeChange, () => themeVersion);
}

type StyleSheetInput = Parameters<typeof StyleSheet.create>[0];

/**
 * StyleSheet.create for styles that use the theme's colours: build runs again after the theme changes, so styles
 * made when a file loads still follow the agency's theme. Every style sheet in the app is made with this.
 */
export function createStyles<S extends StyleSheetInput>(build: () => S & StyleSheetInput): Readonly<S> {
  let built: Readonly<S> | null = null;
  let builtFor = -1;
  const current = (): Readonly<S> => {
    if (built === null || builtFor !== themeVersion) {
      built = StyleSheet.create(build());
      builtFor = themeVersion;
    }
    return built;
  };
  const styles = {} as Readonly<S>;
  for (const key of Object.keys(build())) {
    Object.defineProperty(styles, key, { enumerable: true, get: () => current()[key as keyof S] });
  }
  return styles;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

/** Type scale: every font size in the app comes from here. */
export const font = { display: 28, title: 22, heading: 18, body: 15, small: 13, caption: 12 };

/** Weights for the type scale: headings heavy, labels semibold. */
export const weight = { heavy: '800', bold: '700', semibold: '600', regular: '400' } as const;

/** React Native Web's own system font stack, which every Text uses; for plain web elements (select, date, rich text). */
export const WEB_SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const radius = { sm: 6, md: 8, lg: 12, pill: 999 };

export const shadow = { boxShadow: '0 1px 3px rgba(37, 37, 37, 0.08)' } as const;

/** A dialog floating above the page. */
export const shadowDialog = { boxShadow: '0 12px 32px rgba(37, 37, 37, 0.24)' } as const;

/** Lifted look for a hovered tile. */
export const shadowRaised = { boxShadow: '0 4px 12px rgba(37, 37, 37, 0.12)' } as const;

const WIDE_BREAKPOINT = 900;

export function useIsWide(): boolean {
  return useWindowDimensions().width >= WIDE_BREAKPOINT;
}
