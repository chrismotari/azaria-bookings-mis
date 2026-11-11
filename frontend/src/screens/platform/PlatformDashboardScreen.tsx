import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { PlatformDashboard } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Icon, IconName } from '../../components/Icon';
import { PressState } from '../../components/pressState';
import { Screen } from '../../components/Screen';
import { StatusChip, TONES, Tone } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { PlatformTabParamList } from '../../navigation/types';
import { colors, font, radius, shadow, shadowRaised, space, useIsWide, weight } from '../../theme';
import { formatDate, formatMoney } from '../../utils/format';

type Props = BottomTabScreenProps<PlatformTabParamList, 'PlatformDashboard'>;

const DASHBOARD_KEY = ['platform', 'dashboard'];

export function PlatformDashboardScreen({ navigation }: Props) {
  const dashboard = useQuery({
    queryKey: DASHBOARD_KEY,
    queryFn: async () => (await api.get<PlatformDashboard>('/platform/dashboard')).data,
  });
  // The tab stays mounted: fresh figures each time it is opened (e.g. after marking an invoice paid).
  const { refetch } = dashboard;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );
  if (dashboard.isPending) {
    return <LoadingState />;
  }
  if (dashboard.isError) {
    return <ErrorState error={dashboard.error} onRetry={() => dashboard.refetch()} />;
  }
  const data = dashboard.data;
  const money = (amount: string) => formatMoney(amount, data.currency);
  const { agencies, revenue, recurring, outstanding } = data;

  if (agencies.total === 0) {
    return (
      <Screen>
        <Text style={styles.title}>Dashboard</Text>
        <Card>
          <EmptyState
            icon="business-outline"
            title="No agencies yet"
            message="Add the first agency; its plans, invoices and revenue show here."
          />
          <View style={styles.center}>
            <Button title="Go to Agencies" onPress={() => navigation.navigate('PlatformAgencies')} />
          </View>
        </Card>
      </Screen>
    );
  }

  const suspendedTotal = agencies.suspended + agencies.non_payment;
  const tiles: Tile[] = [
    {
      label: 'Agencies',
      value: String(agencies.total),
      detail: [
        `${agencies.active} active`,
        suspendedTotal
          ? `${suspendedTotal} suspended${agencies.non_payment ? ` (${agencies.non_payment} for non-payment)` : ''}`
          : null,
        agencies.no_plan ? `${agencies.no_plan} without a plan` : null,
      ],
      icon: 'business-outline',
      tone: 'info',
      emphasised: false,
      onPress: () =>
        navigation.navigate('PlatformAgencies', { status: suspendedTotal ? 'suspended' : 'all' }),
      action: suspendedTotal ? 'View suspended' : 'View agencies',
    },
    {
      label: 'Revenue this month',
      value: money(revenue.this_month),
      detail: [`${money(revenue.this_year)} this year`, `${money(revenue.all_time)} in all`],
      icon: 'cash-outline',
      tone: 'success',
      emphasised: false,
      onPress: () => navigation.navigate('PlatformInvoices', { status: 'paid' }),
      action: 'View paid invoices',
    },
    {
      label: 'Monthly recurring',
      value: money(recurring.monthly_value),
      detail: [
        `${recurring.subscriptions} subscription plan${recurring.subscriptions === 1 ? '' : 's'}`,
        `${recurring.support} support plan${recurring.support === 1 ? '' : 's'}`,
        'Annual plans counted as a twelfth',
      ],
      icon: 'repeat-outline',
      tone: 'neutral',
      emphasised: false,
      onPress: () => navigation.navigate('PlatformPlans'),
      action: 'View plans',
    },
    {
      label: 'Outstanding',
      value: money(outstanding.total),
      detail: [`${outstanding.count} unpaid invoice${outstanding.count === 1 ? '' : 's'}`],
      icon: 'hourglass-outline',
      tone: 'warning',
      emphasised: false,
      onPress: () => navigation.navigate('PlatformInvoices', { status: 'unpaid' }),
      action: 'View unpaid',
    },
    {
      label: 'Overdue',
      value: money(outstanding.overdue_total),
      detail: [`${outstanding.overdue_count} invoice${outstanding.overdue_count === 1 ? '' : 's'} past due`],
      icon: 'alert-circle-outline',
      tone: 'danger',
      emphasised: outstanding.overdue_count > 0,
      onPress: () => navigation.navigate('PlatformInvoices', { status: 'overdue' }),
      action: 'View overdue',
    },
  ];

  return (
    <Screen>
      <Text style={styles.title}>Dashboard</Text>
      <View style={styles.grid}>
        {tiles.map((tile) => (
          <SummaryTile key={tile.label} tile={tile} />
        ))}
      </View>
      <RevenueChart months={data.revenue_by_month} money={money} />
      <View style={styles.columns}>
        <View style={styles.column}>
          <Card>
            <Text style={styles.section}>Agencies per plan</Text>
            {data.plans.length === 0 ? (
              <Text style={styles.muted}>No agency is on a plan yet.</Text>
            ) : (
              data.plans.map((plan) => <PlanRow key={plan.id} plan={plan} most={data.plans[0].agencies} />)
            )}
          </Card>
        </View>
        <View style={styles.column}>
          <Card>
            <Text style={styles.section}>Needs attention</Text>
            {data.attention.length === 0 ? (
              <Text style={styles.muted}>Nothing overdue.</Text>
            ) : (
              data.attention.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="link"
                  accessibilityLabel={`${item.number}, ${item.tenant.name}, overdue`}
                  onPress={() => navigation.navigate('PlatformInvoices', { status: 'overdue', id: item.id })}
                  style={({ hovered, pressed }: PressState) => [styles.row, (hovered || pressed) && styles.rowHovered]}
                >
                  <View style={styles.rowMain}>
                    <Text style={styles.strong}>
                      {item.number} · {item.tenant.name}
                    </Text>
                    <Text style={styles.muted}>
                      Due {formatDate(item.due_on)}
                      {item.suspends_on ? ` · suspends ${formatDate(item.suspends_on)}` : ' · suspension waived'}
                    </Text>
                  </View>
                  <Text style={styles.strong}>{money(item.amount)}</Text>
                  <Icon name="chevron-forward" size={16} color={colors.muted} />
                </Pressable>
              ))
            )}
          </Card>
        </View>
      </View>
      <Card>
        <Text style={styles.section}>Fare searches this month</Text>
        {data.fare_searches.length === 0 ? (
          <Text style={styles.muted}>No agency has searched for fares this month.</Text>
        ) : (
          data.fare_searches.map((row) => (
            <Pressable
              key={row.tenant.id}
              accessibilityRole="link"
              accessibilityLabel={`${row.tenant.name}: ${row.used} of ${row.allowance} searches`}
              onPress={() => navigation.navigate('PlatformAgencies', { id: row.tenant.id })}
              style={({ hovered, pressed }: PressState) => [styles.usageRow, (hovered || pressed) && styles.rowHovered]}
            >
              <View style={styles.planTop}>
                <Text style={[styles.strong, styles.shrink]} numberOfLines={1}>
                  {row.tenant.name}
                </Text>
                <Text style={styles.strong}>
                  {row.used.toLocaleString('en-US')} of {row.allowance.toLocaleString('en-US')}
                </Text>
              </View>
              <View style={styles.planTrack}>
                <View
                  style={[
                    styles.planBar,
                    { width: `${Math.min(row.allowance ? row.used / row.allowance : 1, 1) * 100}%` },
                    row.used >= row.allowance * 0.8 && styles.usageHigh,
                  ]}
                />
              </View>
            </Pressable>
          ))
        )}
      </Card>
    </Screen>
  );
}

type Tile = {
  label: string;
  value: string;
  detail: (string | null)[];
  icon: IconName;
  tone: Tone;
  /** Needs the owner's attention: drawn in its tone. */
  emphasised: boolean;
  onPress: () => void;
  action: string;
};

function SummaryTile({ tile }: { tile: Tile }) {
  const { background, color } = TONES[tile.tone];
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${tile.label}: ${tile.value}`}
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

const monthLabel = (month: string, long = false) =>
  new Intl.DateTimeFormat('en-GB', {
    month: long ? 'long' : 'short',
    year: long ? 'numeric' : undefined,
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));

const CHART_HEIGHT = 160;

/** Paid revenue per month; the hovered or pressed bar (initially the current month) is labelled above. */
function RevenueChart({
  months,
  money,
}: {
  months: PlatformDashboard['revenue_by_month'];
  money: (amount: string) => string;
}) {
  const isWide = useIsWide();
  const [chosen, setChosen] = useState(months.length - 1);
  const most = Math.max(...months.map((month) => Number(month.total)));
  const shown = months[chosen];
  return (
    <Card>
      <View style={styles.chartHeader}>
        <Text style={styles.section}>Revenue, last 12 months</Text>
        <Text style={styles.chartValue}>
          {monthLabel(shown.month, true)}: {money(shown.total)}
        </Text>
      </View>
      {most === 0 ? (
        <Text style={styles.muted}>
          No payments recorded yet. Revenue counts invoices on the day they are marked paid.
        </Text>
      ) : null}
      <View style={styles.chart} accessibilityRole="list">
        {months.map((month, index) => {
          const share = most ? Number(month.total) / most : 0;
          const selected = index === chosen;
          return (
            <Pressable
              key={month.month}
              accessibilityRole="button"
              accessibilityLabel={`${monthLabel(month.month, true)}: ${money(month.total)}`}
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

function PlanRow({ plan, most }: { plan: PlatformDashboard['plans'][number]; most: number }) {
  return (
    <View style={styles.planRow}>
      <View style={styles.planTop}>
        <Text style={[styles.strong, styles.shrink]} numberOfLines={1}>
          {plan.name}
        </Text>
        {plan.kind === 'support' ? <StatusChip label="Support" tone="neutral" /> : null}
        <Text style={styles.strong}>
          {plan.agencies} agenc{plan.agencies === 1 ? 'y' : 'ies'}
        </Text>
      </View>
      <View style={styles.planTrack}>
        <View style={[styles.planBar, { width: `${(plan.agencies / most) * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  section: { fontSize: font.heading, fontWeight: weight.bold, color: colors.tertiary },
  center: { alignItems: 'center' },
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
  column: { flexGrow: 1, flexBasis: 340, minWidth: 0 },
  planRow: { gap: space.xs },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  planTrack: { height: 6, borderRadius: 3, backgroundColor: colors.background },
  planBar: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
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
  usageRow: {
    gap: space.xs,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    marginHorizontal: -space.sm,
    borderRadius: radius.sm,
  },
  usageHigh: { backgroundColor: colors.warningText },
  rowMain: { flex: 1, minWidth: 0, gap: 2 },
  strong: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  shrink: { flexShrink: 1, flexGrow: 1 },
  muted: { color: colors.muted },
});
