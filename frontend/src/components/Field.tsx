import { Children, createContext, ReactNode, useContext } from 'react';
import { Text, View } from 'react-native';

import { colors, createStyles, font, radius, weight } from '../theme';
import { Icon } from './Icon';

const OnBarContext = createContext(false);

/** Fields inside it sit on the bar: labels and errors in its text colour. */
export function OnBar({ children }: { children: ReactNode }) {
  return <OnBarContext.Provider value>{children}</OnBarContext.Provider>;
}

/** The input's style; on the bar an error also turns its border to the danger colour. */
export function useInputStyle(error?: string) {
  const onBar = useContext(OnBarContext);
  return onBar && error ? { ...inputStyle, borderColor: colors.danger, borderWidth: 2 } : inputStyle;
}

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  const onBar = useContext(OnBarContext);
  return (
    <View style={styles.field}>
      <Text style={[styles.label, onBar && styles.onBar]}>{label}</Text>
      {children}
      {error && onBar ? (
        <View style={styles.errorRow}>
          <Icon name="alert-circle" size={16} color={colors.barText} />
          <Text style={[styles.error, styles.onBar]}>{error}</Text>
        </View>
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : null}
    </View>
  );
}

/** Fields side by side, wrapping onto new rows; `columns={2}` caps it at two per row (one on a phone). */
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

const styles = createStyles(() => ({
  field: { gap: 4, minWidth: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridItem: { flexGrow: 1, flexBasis: 180, minWidth: 0 },
  twoColumns: { flexBasis: 260 },
  label: { fontSize: font.small, fontWeight: weight.semibold, color: colors.muted },
  error: { fontSize: font.small, color: colors.danger },
  formError: { fontSize: font.small },
  onBar: { color: colors.barText },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
}));
