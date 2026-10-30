import { StyleSheet, Text, View } from 'react-native';

import { colors, radius } from '../theme';

export type Tone = 'info' | 'success' | 'warning' | 'neutral' | 'danger';

const TONES: Record<Tone, { background: string; color: string }> = {
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
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 10 },
  text: { fontSize: 12, fontWeight: '700' },
});
