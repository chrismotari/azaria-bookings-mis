import { StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, weight } from '../theme';

export type Tone = 'info' | 'success' | 'warning' | 'neutral' | 'danger';

/** Tint and text colour per tone; the text colour is also the tone's accent (dots, edges). */
export const TONES: Record<Tone, { background: string; color: string }> = {
  info: { background: colors.infoTint, color: colors.infoText },
  success: { background: colors.successTint, color: colors.successText },
  warning: { background: colors.warningTint, color: colors.warningText },
  neutral: { background: colors.neutralTint, color: colors.neutralText },
  danger: { background: colors.dangerTint, color: colors.dangerText },
};

export function StatusChip({ label, tone }: { label: string; tone: Tone }) {
  const { background, color } = TONES[tone];
  return (
    <View style={[styles.chip, { backgroundColor: background }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: font.caption, fontWeight: weight.bold },
});
