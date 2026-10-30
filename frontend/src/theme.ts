import { useWindowDimensions } from 'react-native';

/**
 * Brand colours from azariabookings.com (assets/css/sections/variables.css).
 * Status text shades are darker than the brand status colours so text on
 * their tints meets WCAG AA (4.5:1).
 */
export const colors = {
  primary: '#1800d2',
  primaryText: '#ffffff',
  primaryTint: '#ebe8fd',
  primaryMutedText: '#d4d0f7',
  accent: '#ffb400',
  accentText: '#252525',
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
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 6, md: 8, pill: 999 };

export const shadow = { boxShadow: '0 1px 3px rgba(37, 37, 37, 0.08)' } as const;

export const WIDE_BREAKPOINT = 900;

export function useIsWide(): boolean {
  return useWindowDimensions().width >= WIDE_BREAKPOINT;
}
