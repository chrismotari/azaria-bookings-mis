import { Children, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, weight } from '../theme';

/** Label, control and validation message. */
export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

/**
 * Lays fields out side by side, wrapping onto new rows when space runs out.
 * `columns={2}`: at most two per row, one per row on a phone.
 */
export function FieldGrid({ children, columns }: { children: ReactNode; columns?: 2 }) {
  return (
    <View style={styles.grid}>
      {Children.map(children, (child) => (
        <View style={[styles.gridItem, columns === 2 && styles.twoColumns]}>{child}</View>
      ))}
    </View>
  );
}

export function FormError({ message }: { message: string | null | undefined }) {
  return message ? <Text style={[styles.error, styles.formError]}>{message}</Text> : null;
}

export const inputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.sm,
  paddingHorizontal: 10,
  paddingVertical: 8,
  fontSize: font.body,
  color: colors.text,
  backgroundColor: colors.surface,
  minWidth: 0,
  minHeight: 38,
} as const;

const styles = StyleSheet.create({
  field: { gap: 4, minWidth: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridItem: { flexGrow: 1, flexBasis: 180, minWidth: 0 },
  twoColumns: { flexBasis: 260 },
  label: { fontSize: font.small, fontWeight: weight.semibold, color: colors.muted },
  error: { fontSize: font.small, color: colors.danger },
  formError: { fontSize: font.small },
});
