import { Children, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme';

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

/** Lays fields out side by side, wrapping onto new rows when space runs out. */
export function FieldGrid({ children }: { children: ReactNode }) {
  return (
    <View style={styles.grid}>
      {Children.map(children, (child) => (
        <View style={styles.gridItem}>{child}</View>
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
  borderRadius: 6,
  paddingHorizontal: 10,
  paddingVertical: 8,
  fontSize: 15,
  color: colors.text,
  backgroundColor: colors.surface,
  minWidth: 0,
  minHeight: 38,
} as const;

const styles = StyleSheet.create({
  field: { gap: 4, minWidth: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridItem: { flexGrow: 1, flexBasis: 180, minWidth: 0 },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted },
  error: { fontSize: 13, color: colors.danger },
  formError: { fontSize: 14 },
});
