import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { PlatformDashboard } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import {
  Column,
  Columns,
  dashboardStyles,
  LinkRow,
  MonthChart,
  SectionTitle,
  ShareBar,
  Tile,
  TileGrid,
  UsageBar,
} from '../../components/Dashboard';
import { Screen } from '../../components/Screen';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { PlatformTabParamList } from '../../navigation/types';
import { space } from '../../theme';
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
      onPress: () => navigation.navigate('PlatformAgencies', { status: suspendedTotal ? 'suspended' : 'all' }),
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
      <TileGrid tiles={tiles} />
      <MonthChart
        title="Revenue, last 12 months"
        months={data.revenue_by_month}
        money={money}
        empty="No payments recorded yet. Revenue counts invoices on the day they are marked paid."
      />
      <Columns>
        <Column>
          <Card>
            <SectionTitle>Agencies per plan</SectionTitle>
            {data.plans.length === 0 ? (
              <Text style={styles.muted}>No agency is on a plan yet.</Text>
            ) : (
              data.plans.map((plan) => <PlanRow key={plan.id} plan={plan} most={data.plans[0].agencies} />)
            )}
          </Card>
        </Column>
        <Column>
          <Card>
            <SectionTitle>Needs attention</SectionTitle>
            {data.attention.length === 0 ? (
              <Text style={styles.muted}>Nothing overdue.</Text>
            ) : (
              data.attention.map((item) => (
                <LinkRow
                  key={item.id}
                  label={`${item.number}, ${item.tenant.name}, overdue`}
                  onPress={() => navigation.navigate('PlatformInvoices', { status: 'overdue', id: item.id })}
                  value={<Text style={styles.strong}>{money(item.amount)}</Text>}
                >
                  <Text style={styles.strong}>
                    {item.number} · {item.tenant.name}
                  </Text>
                  <Text style={styles.muted}>
                    Due {formatDate(item.due_on)}
                    {item.suspends_on ? ` · suspends ${formatDate(item.suspends_on)}` : ' · suspension waived'}
                  </Text>
                </LinkRow>
              ))
            )}
          </Card>
        </Column>
      </Columns>
      <Card>
        <SectionTitle>Fare searches this month</SectionTitle>
        {data.fare_searches.length === 0 ? (
          <Text style={styles.muted}>No agency has searched for fares this month.</Text>
        ) : (
          data.fare_searches.map((row) => (
            <LinkRow
              key={row.tenant.id}
              label={`${row.tenant.name}: ${row.used} of ${row.allowance} searches`}
              onPress={() => navigation.navigate('PlatformAgencies', { id: row.tenant.id })}
            >
              <View style={styles.between}>
                <Text style={[styles.strong, styles.shrink]} numberOfLines={1}>
                  {row.tenant.name}
                </Text>
                <Text style={styles.strong}>
                  {row.used.toLocaleString('en-US')} of {row.allowance.toLocaleString('en-US')}
                </Text>
              </View>
              <UsageBar used={row.used} allowance={row.allowance} />
            </LinkRow>
          ))
        )}
      </Card>
    </Screen>
  );
}

function PlanRow({ plan, most }: { plan: PlatformDashboard['plans'][number]; most: number }) {
  return (
    <View style={styles.planRow}>
      <View style={styles.between}>
        <Text style={[styles.strong, styles.shrink]} numberOfLines={1}>
          {plan.name}
        </Text>
        {plan.kind === 'support' ? <StatusChip label="Support" tone="neutral" /> : null}
        <Text style={styles.strong}>
          {plan.agencies} agenc{plan.agencies === 1 ? 'y' : 'ies'}
        </Text>
      </View>
      <ShareBar share={plan.agencies / most} />
    </View>
  );
}

const styles = StyleSheet.create({
  ...dashboardStyles,
  center: { alignItems: 'center' },
  planRow: { gap: space.xs },
});
