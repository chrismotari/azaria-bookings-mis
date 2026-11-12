import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { Dashboard } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
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
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { AdminTabParamList } from '../../navigation/types';
import { colors, font, space, weight } from '../../theme';
import { timeLeft, passengersLabel } from '../../utils/bookings';
import { formatDate, formatMoney, formatPrice, routeCodes } from '../../utils/format';

type Props = BottomTabScreenProps<AdminTabParamList, 'AdminDashboard'>;
type Route = Dashboard['top_routes'][number];

/** "Good morning" etc. by the time of day in Nairobi. */
function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Africa/Nairobi' }).format(
      new Date(),
    ),
  );
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

const plural = (count: number, word: string) => `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;
const routeLine = (route: Pick<Route, 'origin' | 'destination' | 'trip_type'>) =>
  routeCodes(route.origin, route.destination, route.trip_type === 'return');

export function AdminDashboardScreen({ navigation }: Props) {
  const { user } = useAuth();
  // Ticks each minute, for the payment countdowns.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const dashboard = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: async () => (await api.get<Dashboard>('/admin/dashboard')).data,
  });
  // The tab stays mounted: fresh figures each time it is opened (e.g. after marking a booking paid).
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
  const firstName = user?.full_name.trim().split(/\s+/)[0];
  const count = (value: number) => value.toLocaleString('en-US');
  const overdue = data.overdue_invoice;

  const needsAction: Tile[] = [
    ...(overdue
      ? [
          {
            label: 'Overdue invoice',
            value: formatMoney(overdue.amount, overdue.currency),
            detail: [
              `${overdue.number}, due ${formatDate(overdue.due_on)}`,
              `Suspended on ${formatDate(overdue.suspends_on)} if unpaid`,
            ],
            icon: 'alert-circle-outline' as const,
            tone: 'danger' as const,
            emphasised: true,
            onPress: () => navigation.navigate('AdminBilling'),
            action: 'View billing',
          },
        ]
      : []),
    {
      label: 'Bookings to confirm',
      value: count(data.bookings_requested),
      detail: [],
      icon: 'checkmark-done-outline',
      tone: 'warning',
      emphasised: data.bookings_requested > 0,
      onPress: () => navigation.navigate('AdminBookings', { status: 'requested' }),
      action: 'View',
    },
    {
      label: 'Paid, boarding pass due',
      value: count(data.bookings_paid_awaiting_boarding_pass),
      detail: [],
      icon: 'document-attach-outline',
      tone: 'success',
      emphasised: data.bookings_paid_awaiting_boarding_pass > 0,
      onPress: () => navigation.navigate('AdminBookings', { status: 'paid' }),
      action: 'View',
    },
    {
      label: 'Open requests',
      value: count(data.open_queries),
      detail: [],
      icon: 'chatbubbles-outline',
      tone: 'info',
      emphasised: false,
      onPress: () => navigation.navigate('AdminRequests', { status: 'open' }),
      action: 'View',
    },
    {
      label: 'Awaiting payment',
      value: count(data.bookings_awaiting_payment),
      detail: [],
      icon: 'card-outline',
      tone: 'neutral',
      emphasised: false,
      onPress: () => navigation.navigate('AdminBookings', { status: 'availability_confirmed' }),
      action: 'View',
    },
    ...(data.new_fares > 0
      ? [
          {
            label: 'New fares to review',
            value: count(data.new_fares),
            detail: [],
            icon: 'airplane-outline' as const,
            tone: 'info' as const,
            emphasised: true,
            onPress: () => navigation.navigate('AdminRoutes'),
            action: 'View',
          },
        ]
      : []),
  ];

  const allBookings = () => navigation.navigate('AdminBookings', { status: 'all' });
  const sales: Tile[] = [
    {
      label: 'Sales this month',
      value: formatPrice(data.sales.this_month),
      detail: [plural(data.sales.count_this_month, 'booking')],
      icon: 'cash-outline',
      tone: 'success',
      emphasised: false,
      onPress: allBookings,
      action: 'View bookings',
    },
    {
      label: 'This year',
      value: formatPrice(data.sales.this_year),
      detail: [],
      icon: 'calendar-outline',
      tone: 'neutral',
      emphasised: false,
      onPress: allBookings,
      action: 'View bookings',
    },
    {
      label: 'All time',
      value: formatPrice(data.sales.all_time),
      detail: [],
      icon: 'trending-up-outline',
      tone: 'neutral',
      emphasised: false,
      onPress: allBookings,
      action: 'View bookings',
    },
  ];
  const openBooking = (id: string) => navigation.navigate('AdminBookings', { status: 'all', id });
  const mostSold = data.top_routes[0]?.count ?? 0;

  return (
    <Screen>
      <View>
        <Text style={styles.title}>Dashboard</Text>
        <Text style={styles.greeting}>
          {greeting()}
          {firstName ? `, ${firstName}` : ''}.
        </Text>
      </View>

      <SectionTitle>Needs action</SectionTitle>
      <TileGrid tiles={needsAction} />

      <SectionTitle>Sales</SectionTitle>
      <TileGrid tiles={sales} />
      <MonthChart
        title="Sales, last 12 months"
        months={data.sales_by_month}
        money={formatPrice}
        empty="No sales yet. A booking counts on the day it is marked paid."
        countLabel={(value) => plural(value, 'booking')}
      />

      <Columns>
        <Column>
          <Card>
            <SectionTitle>Coming up</SectionTitle>
            <Text style={styles.subheading}>Payments due in 48 hours</Text>
            {data.payments_due.length === 0 ? (
              <Text style={styles.muted}>Nothing due.</Text>
            ) : (
              data.payments_due.map((item) => (
                <LinkRow
                  key={item.id}
                  label={`${item.customer.name}, ${routeLine(item.route)}, ${formatPrice(item.total)}, ${timeLeft(item.payment_deadline, now)}`}
                  onPress={() => openBooking(item.id)}
                  value={<Text style={styles.strong}>{formatPrice(item.total)}</Text>}
                >
                  <Text style={styles.strong} numberOfLines={1}>
                    {item.customer.name}
                  </Text>
                  <Text style={styles.muted} numberOfLines={1}>
                    {routeLine(item.route)} · {timeLeft(item.payment_deadline, now)}
                  </Text>
                </LinkRow>
              ))
            )}
            <Text style={styles.subheading}>Departing this week</Text>
            {data.departures.length === 0 ? (
              <Text style={styles.muted}>No departures this week.</Text>
            ) : (
              data.departures.map((item) => (
                <LinkRow
                  key={item.id}
                  label={`${item.customer.name}, ${routeLine(item.route)}, ${formatDate(item.departure_date)}${item.boarding_passes_sent ? '' : ', passes not sent'}`}
                  onPress={() => openBooking(item.id)}
                >
                  <Text style={styles.strong} numberOfLines={1}>
                    {item.customer.name}
                  </Text>
                  <Text style={styles.muted} numberOfLines={1}>
                    {routeLine(item.route)} · {formatDate(item.departure_date)} ·{' '}
                    {passengersLabel(item.passenger_count)}
                  </Text>
                  {item.boarding_passes_sent ? null : (
                    <View style={styles.chip}>
                      <StatusChip label="Passes not sent" tone="warning" />
                    </View>
                  )}
                </LinkRow>
              ))
            )}
          </Card>
        </Column>
        <Column>
          <Card>
            <SectionTitle>Top routes this year</SectionTitle>
            {data.top_routes.length === 0 ? (
              <Text style={styles.muted}>No sales this year yet.</Text>
            ) : (
              data.top_routes.map((item) => (
                <View
                  key={`${routeLine(item)}`}
                  style={styles.routeRow}
                  accessibilityLabel={`${routeLine(item)}: ${plural(item.count, 'booking')}, ${formatPrice(item.total)}`}
                >
                  <View style={styles.between}>
                    <View style={styles.shrink}>
                      <Text style={styles.strong}>{routeLine(item)}</Text>
                      <Text style={styles.muted} numberOfLines={1}>
                        {item.origin.city} {item.trip_type === 'return' ? '⇄' : '→'} {item.destination.city}
                      </Text>
                    </View>
                    <View style={styles.figures}>
                      <Text style={styles.strong}>{formatPrice(item.total)}</Text>
                      <Text style={styles.muted}>{plural(item.count, 'booking')}</Text>
                    </View>
                  </View>
                  <ShareBar share={mostSold ? item.count / mostSold : 0} />
                </View>
              ))
            )}
          </Card>
        </Column>
      </Columns>

      <Columns>
        <Column>
          <Card>
            <SectionTitle>Customers</SectionTitle>
            <Text style={styles.big}>{count(data.customers.total)}</Text>
            <Text style={styles.muted}>{count(data.customers.new_this_month)} new this month</Text>
            <View style={styles.actions}>
              <Button title="View users" variant="link" onPress={() => navigation.navigate('AdminUsers')} />
            </View>
          </Card>
        </Column>
        <Column>
          <Card>
            <SectionTitle>Offers and searches</SectionTitle>
            <Text style={styles.big}>{count(data.offers.bookable)}</Text>
            <Text style={styles.muted}>
              {data.offers.bookable === 1 ? 'offer open for booking' : 'offers open for booking'},{' '}
              {count(data.offers.public_bookable)} public
            </Text>
            <LinkRow
              label={`${plural(data.offers.expiring_soon, 'offer')} expire within 7 days`}
              onPress={() => navigation.navigate('AdminOffers')}
            >
              <Text style={data.offers.expiring_soon ? styles.warning : styles.text}>
                {plural(data.offers.expiring_soon, 'offer')} expire{data.offers.expiring_soon === 1 ? 's' : ''} within 7
                days
              </Text>
            </LinkRow>
            {data.searches ? (
              <LinkRow
                label={`Fare searches this month: ${data.searches.used} of ${data.searches.allowance}`}
                onPress={() => navigation.navigate('AdminRoutes')}
              >
                <View style={styles.between}>
                  <Text style={[styles.text, styles.shrink]}>Fare searches this month</Text>
                  <Text style={styles.strong}>
                    {count(data.searches.used)} of {count(data.searches.allowance)}
                  </Text>
                </View>
                <UsageBar used={data.searches.used} allowance={data.searches.allowance} />
              </LinkRow>
            ) : null}
          </Card>
        </Column>
      </Columns>
    </Screen>
  );
}

const styles = StyleSheet.create({
  ...dashboardStyles,
  greeting: { fontSize: font.body, color: colors.muted, marginTop: space.xs },
  subheading: { fontSize: font.small, fontWeight: weight.bold, color: colors.muted, textTransform: 'uppercase' },
  big: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  warning: { fontSize: font.body, fontWeight: weight.semibold, color: colors.warningText },
  actions: { alignItems: 'flex-start' },
  routeRow: { gap: space.xs, paddingVertical: space.xs },
  figures: { alignItems: 'flex-end' },
  chip: { alignSelf: 'flex-start', marginTop: 2 },
});
