import { ReactNode, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, shadow, shadowRaised, space, useIsWide, weight } from '../theme';
import { Card } from './Card';
import { Icon, IconName } from './Icon';
import { PressState } from './pressState';
import { TONES, Tone } from './StatusChip';

/** The building blocks shared by the platform and agency dashboards. */

export type Tile = {
  label: string;
  value: string;
  detail: (string | null)[];
  icon: IconName;
  tone: Tone;
  /** Needs attention: drawn in its tone. */
  emphasised: boolean;
  onPress: () => void;
  action: string;
};

export function SummaryTile({ tile }: { tile: Tile }) {
  const { background, color } = TONES[tile.tone];
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${tile.label}: ${tile.value}${tile.emphasised ? ', needs action' : ''}`}
      onPress={tile.onPress}
      style={({ pressed, hovered }: PressState) => [
        styles.tile,
        { borderTopColor: color },
        tile.emphasised && { backgroundColor: background, borderColor: color },
        (pressed || hovered) && shadowRaised,
      ]}
    >
      <View style={[styles.iconCircle, { backgroundColor: tile.emphasised ? colors.surface : background }]}>
        <Icon name={tile.icon} size={20} color={color} />
      </View>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {tile.value}
      </Text>
      <Text style={styles.label}>{tile.label}</Text>
      {tile.detail.filter(Boolean).map((line) => (
        <Text key={line} style={styles.muted}>
          {line}
        </Text>
      ))}
      <View style={styles.view}>
        <Text style={styles.viewText}>{tile.action}</Text>
        <Icon name="arrow-forward" size={16} color={colors.primary} />
      </View>
    </Pressable>
  );
}

export function TileGrid({ tiles }: { tiles: Tile[] }) {
  return (
    <View style={styles.grid}>
      {tiles.map((tile) => (
        <SummaryTile key={tile.label} tile={tile} />
      ))}
    </View>
  );
}

export const monthLabel = (month: string, long = false) =>
  new Intl.DateTimeFormat('en-GB', {
    month: long ? 'long' : 'short',
    year: long ? 'numeric' : undefined,
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));

const CHART_HEIGHT = 160;

type Month = { month: string; total: string; count?: number };

/** An amount per month in plain views; the hovered or pressed bar (initially the current month) is labelled above. */
export function MonthChart({
  title,
  months,
  money,
  empty,
  countLabel,
}: {
  title: string;
  months: Month[];
  money: (amount: string) => string;
  /** Shown when every month is zero. */
  empty: string;
  /** e.g. (2) => "2 bookings", for months that carry a count. */
  countLabel?: (count: number) => string;
}) {
  const isWide = useIsWide();
  const [chosen, setChosen] = useState(months.length - 1);
  const most = Math.max(...months.map((month) => Number(month.total)));
  const describe = (month: Month) =>
    `${money(month.total)}${countLabel && month.count !== undefined ? `, ${countLabel(month.count)}` : ''}`;
  const shown = months[chosen];
  return (
    <Card>
      <View style={styles.chartHeader}>
        <Text style={styles.section}>{title}</Text>
        <Text style={styles.chartValue}>
          {monthLabel(shown.month, true)}: {describe(shown)}
        </Text>
      </View>
      {most === 0 ? <Text style={styles.muted}>{empty}</Text> : null}
      <View style={styles.chart} accessibilityRole="list">
        {months.map((month, index) => {
          const share = most ? Number(month.total) / most : 0;
          const selected = index === chosen;
          return (
            <Pressable
              key={month.month}
              accessibilityRole="button"
              accessibilityLabel={`${monthLabel(month.month, true)}: ${describe(month)}`}
              accessibilityState={{ selected }}
              onPress={() => setChosen(index)}
              onHoverIn={() => setChosen(index)}
              style={styles.barColumn}
            >
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.bar,
                    { height: Math.max(share * CHART_HEIGHT, Number(month.total) > 0 ? 3 : 1) },
                    selected ? styles.barChosen : null,
                    Number(month.total) === 0 && styles.barEmpty,
                  ]}
                />
              </View>
              <Text style={[styles.barLabel, selected && styles.barLabelChosen]} numberOfLines={1}>
                {isWide || index % 2 === months.length % 2 ? monthLabel(month.month) : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

/** Two cards side by side from about 700 px, stacked below. */
export function Columns({ children }: { children: ReactNode }) {
  return <View style={styles.columns}>{children}</View>;
}

export function Column({ children }: { children: ReactNode }) {
  return <View style={styles.column}>{children}</View>;
}

export function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.section}>{children}</Text>;
}

/** A row that opens something: main text on the left, an optional value, a chevron. */
export function LinkRow({
  label,
  onPress,
  children,
  value,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
  value?: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ hovered, pressed }: PressState) => [styles.row, (hovered || pressed) && styles.rowHovered]}
    >
      <View style={styles.rowMain}>{children}</View>
      {value}
      <Icon name="chevron-forward" size={16} color={colors.muted} />
    </Pressable>
  );
}

/** Used against an allowance as a thin bar, in the warning colour from 80%. */
export function UsageBar({ used, allowance }: { used: number; allowance: number }) {
  return (
    <View style={styles.track}>
      <View
        style={[
          styles.fillBar,
          { width: `${Math.min(allowance ? used / allowance : 1, 1) * 100}%` },
          used >= allowance * 0.8 && styles.usageHigh,
        ]}
      />
    </View>
  );
}

/** A share of the largest value as a thin bar. */
export function ShareBar({ share }: { share: number }) {
  return (
    <View style={styles.track}>
      <View style={[styles.fillBar, { width: `${Math.min(share, 1) * 100}%` }]} />
    </View>
  );
}

export const dashboardStyles = StyleSheet.create({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  strong: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  text: { fontSize: font.body, color: colors.text },
  muted: { color: colors.muted },
  shrink: { flexShrink: 1, flexGrow: 1 },
  between: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});

const styles = StyleSheet.create({
  section: { fontSize: font.heading, fontWeight: weight.bold, color: colors.tertiary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: {
    flexGrow: 1,
    flexBasis: 200,
    minWidth: 0,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 4,
    padding: space.lg,
    gap: 2,
    ...shadow,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  value: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  label: { fontSize: font.body, fontWeight: weight.semibold, color: colors.text, marginBottom: space.xs },
  view: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.sm },
  viewText: { fontSize: font.small, fontWeight: weight.bold, color: colors.primary },
  muted: { color: colors.muted },
  chartHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space.sm,
  },
  chartValue: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xs, paddingTop: space.sm },
  barColumn: { flex: 1, minWidth: 0, alignItems: 'center', gap: space.xs },
  barTrack: { height: CHART_HEIGHT, width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  bar: {
    width: '70%',
    maxWidth: 40,
    backgroundColor: colors.primaryTint,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  barChosen: { backgroundColor: colors.primary },
  barEmpty: { backgroundColor: colors.border },
  barLabel: { fontSize: font.caption, color: colors.muted },
  barLabelChosen: { color: colors.text, fontWeight: weight.bold },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  column: { flexGrow: 1, flexBasis: 340, minWidth: 0, gap: space.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    marginHorizontal: -space.sm,
    borderRadius: radius.sm,
  },
  rowHovered: { backgroundColor: colors.background },
  rowMain: { flex: 1, minWidth: 0, gap: 2 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.background },
  fillBar: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  usageHigh: { backgroundColor: colors.warningText },
});
