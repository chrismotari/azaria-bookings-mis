import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, shadow, space, weight } from '../theme';

/** The actions available for an item's current status, together at the top of its detail. */
export function ActionBar({ label = 'Actions', children }: { label?: string; children: ReactNode }) {
  return (
    <View style={styles.bar} accessibilityRole="toolbar" aria-label={label}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.buttons}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    padding: space.md,
    paddingLeft: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadow,
  },
  label: { fontSize: font.small, fontWeight: weight.bold, color: colors.muted, textTransform: 'uppercase' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
