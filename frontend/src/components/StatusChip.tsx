import { StyleSheet, Text, View } from 'react-native';

export type Tone = 'info' | 'success' | 'warning' | 'neutral' | 'danger';

const TONES: Record<Tone, { background: string; color: string }> = {
  info: { background: '#e3eef5', color: '#0b5c8a' },
  success: { background: '#e3f4ea', color: '#1d7a46' },
  warning: { background: '#fdf1dc', color: '#8a5a00' },
  neutral: { background: '#eceff2', color: '#4a5560' },
  danger: { background: '#fbe6e4', color: '#b42318' },
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
  chip: { alignSelf: 'flex-start', borderRadius: 12, paddingVertical: 3, paddingHorizontal: 10 },
  text: { fontSize: 12, fontWeight: '700' },
});
