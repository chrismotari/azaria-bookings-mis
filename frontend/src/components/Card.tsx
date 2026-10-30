import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, radius, shadow, space } from '../theme';

export function Card({ children, selected }: { children: ReactNode; selected?: boolean }) {
  return (
    <View style={[styles.card, selected && styles.selected]} aria-current={selected}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
    ...shadow,
  },
  selected: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
});
