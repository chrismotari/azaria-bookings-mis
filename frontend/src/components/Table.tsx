import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Airport } from '../api/types';
import { colors, font, radius, shadow, space, weight } from '../theme';
import { PressState } from './pressState';

/** A column's heading and its share of the row width. */
export type Column = { label: string; flex: number };

/** Rows are TableRow. */
export function Table({ columns, children }: { columns: Column[]; children: ReactNode }) {
  return (
    <View style={styles.table}>
      <View style={[styles.row, styles.header]}>
        {columns.map((column) => (
          <Text key={column.label} style={[styles.th, { flex: column.flex }]}>
            {column.label}
          </Text>
        ))}
      </View>
      {children}
    </View>
  );
}

type RowProps = {
  columns: Column[];
  /** One cell per column. */
  cells: ReactNode[];
  selected?: boolean;
  /** Makes the whole row a link to the item; leave out for rows with their own controls. */
  onPress?: () => void;
  accessibilityLabel?: string;
};

export function TableRow({ columns, cells, selected, onPress, accessibilityLabel }: RowProps) {
  const content = cells.map((cell, index) => (
    <View key={columns[index].label} style={[styles.cell, { flex: columns[index].flex }]}>
      {typeof cell === 'string' ? <Text style={styles.text}>{cell}</Text> : cell}
    </View>
  ));
  if (!onPress) {
    return (
      <View style={[styles.row, styles.body, selected && styles.selected]} aria-current={selected}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      aria-current={selected}
      onPress={onPress}
      style={({ hovered, pressed }: PressState) => [
        styles.row,
        styles.body,
        (hovered || pressed) && styles.hovered,
        selected && styles.selected,
      ]}
    >
      {content}
    </Pressable>
  );
}

type RouteCellProps = { origin: Airport | null; destination: Airport | null; returnTrip?: boolean };

/** Airport codes with their cities underneath, joined by ⇄ for a return trip; null is "Any" (a request without that airport). */
export function RouteCell({ origin, destination, returnTrip }: RouteCellProps) {
  const arrow = returnTrip ? '⇄' : '→';
  return (
    <View>
      <Text style={styles.strong}>
        {origin?.code ?? 'Any'} {arrow} {destination?.code ?? 'Any'}
      </Text>
      <Text style={styles.muted} numberOfLines={1}>
        {origin?.city ?? 'Anywhere'} {arrow} {destination?.city ?? 'Anywhere'}
      </Text>
    </View>
  );
}

/** A first line with a small muted second line, cut to one line (e.g. an email address). */
export function TwoLineCell({ primary, secondary }: { primary: string; secondary?: string }) {
  return (
    <View>
      <Text style={styles.text}>{primary}</Text>
      {secondary ? (
        <Text style={styles.muted} numberOfLines={1}>
          {secondary}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    ...shadow,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  header: { backgroundColor: colors.neutralTint, paddingVertical: space.md },
  body: { minHeight: 68, paddingVertical: space.md, backgroundColor: colors.surface },
  hovered: { backgroundColor: colors.background },
  selected: { backgroundColor: colors.primaryTint },
  cell: { minWidth: 0 },
  th: {
    fontSize: font.caption,
    fontWeight: weight.bold,
    color: colors.neutralText,
    textTransform: 'uppercase',
    minWidth: 0,
  },
  text: { fontSize: font.body, color: colors.text },
  strong: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
});
