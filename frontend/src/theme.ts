import { useWindowDimensions } from 'react-native';

export const colors = {
  primary: '#0b5c8a',
  primaryText: '#ffffff',
  text: '#1c2733',
  muted: '#5f6b78',
  border: '#d5dce3',
  background: '#f4f6f8',
  surface: '#ffffff',
  danger: '#b42318',
  success: '#1d7a46',
};

export const WIDE_BREAKPOINT = 900;

export function useIsWide(): boolean {
  return useWindowDimensions().width >= WIDE_BREAKPOINT;
}
