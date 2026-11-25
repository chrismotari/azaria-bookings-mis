import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { MODULE_LABELS } from '../../agency/modules';
import { api } from '../../api/client';
import { ComingUp, Dashboard, Module, ModuleAmount, PaymentDue, TopSeller } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import {
  ChartSeries,
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
import { Icon, IconName } from '../../components/Icon';
import { Screen } from '../../components/Screen';
import { StatusChip } from '../../components/StatusChip';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { AdminTabParamList } from '../../navigation/types';
import { colors, createStyles, font, space, weight } from '../../theme';
import { passengersLabel, timeLeft } from '../../utils/bookings';
import { formatDate, formatMoney, formatPrice } from '../../utils/format';
import { nightsLabel, roomsLabel } from '../../utils/hotels';

type Props = BottomTabScreenProps<AdminTabParamList, 'AdminDashboard'>;
type Navigation = Props['navigation'];
type Kind = 'flight' | 'tour' | 'hotel';

const KIND_ICONS: Record<Kind, IconName> = {
  flight: 'airplane-outline',
  tour: 'location-outline',
  hotel: 'bed-outline',
};
const KIND_LABELS: Record<Kind, string> = { flight: 'Flight', tour: 'Tour', hotel: 'Hotel' };

/** "Good morning" etc. by the time of day in Nairobi. */
function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Africa/Nairobi' }).format(
      new Date(),
    ),
  );
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

const count = (value: number) => value.toLocaleString('en-US');
const plural = (value: number, word: string) => `${value.toLocaleString('en-US')} ${word}${value === 1 ? '' : 's'}`;

/** "Flights $X · Tours $Y" under a sales figure, with more than one module. */
function breakdown(amount: ModuleAmount, modules: Module[]): string | null {
  if (modules.length < 2) {
    return null;
  }
  return modules
    .map((module) => `${MODULE_LABELS[module]} ${formatPrice(amount.by_module[module] ?? '0')}`)
    .join(' · ');
}

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
  const modules = data.modules;
  const several = modules.length > 1;
  const firstName = user?.full_name.trim().split(/\s+/)[0];

  const allSales = () => {
    if (modules.includes('flights')) {
      navigation.navigate('AdminBookings', { status: 'all' });
    } else if (modules.includes('hotels')) {
      navigation.navigate('AdminHotels', { status: 'all' });
    } else {
      navigation.navigate('AdminTours', { status: 'all' });
    }
  };
  const sales: Tile[] = [
    {
      label: 'Sales this month',
      amount: data.sales.this_month,
      icon: 'cash-outline' as const,
      tone: 'success' as const,
    },
    { label: 'This year', amount: data.sales.this_year, icon: 'calendar-outline' as const, tone: 'neutral' as const },
    { label: 'All time', amount: data.sales.all_time, icon: 'trending-up-outline' as const, tone: 'neutral' as const },
  ].map(({ label, amount, icon, tone }, index) => ({
    label,
    value: formatPrice(amount.total),
    detail: [index === 0 ? plural(data.sales.count_this_month, 'booking') : null, breakdown(amount, modules)],
    icon,
    tone,
    emphasised: false,
    onPress: allSales,
    action: 'View bookings',
  }));
  const series: ChartSeries[] = (
    [
      { key: 'flights', label: 'Flights', color: colors.primary },
      { key: 'tours', label: 'Tours', color: colors.accent },
      { key: 'hotels', label: 'Hotels', color: colors.tertiary },
    ] as const
  ).filter((part) => modules.includes(part.key));

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
      <TileGrid tiles={needsAction(data, navigation)} />

      <SectionTitle>Sales</SectionTitle>
      <TileGrid tiles={sales} />
      <MonthChart
        title="Sales, last 12 months"
        months={data.sales_by_month}
        money={formatPrice}
        empty={
          modules.includes('tours')
            ? modules.length > 1
              ? 'No sales yet. A booking counts on the day it is marked paid, or when a tour is booked.'
              : 'No sales yet. A booking counts on the day it is made.'
            : 'No sales yet. A booking counts on the day it is marked paid.'
        }
        countLabel={(value) => plural(value, 'booking')}
        series={series}
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
                <PaymentRow key={item.id} item={item} icons={several} now={now} navigation={navigation} />
              ))
            )}
            <Text style={styles.subheading}>This week</Text>
            {data.this_week.length === 0 ? (
              <Text style={styles.muted}>Nothing this week.</Text>
            ) : (
              data.this_week.map((item) => (
                <WeekRow key={`${item.kind}-${item.id}`} item={item} icons={several} navigation={navigation} />
              ))
            )}
          </Card>
        </Column>
        <Column>
          <TopSellers rows={data.top_sellers} icons={several} navigation={navigation} />
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
          <OnSale data={data} navigation={navigation} />
        </Column>
      </Columns>
    </Screen>
  );
}

function tile(
  label: string,
  value: number,
  icon: IconName,
  tone: Tile['tone'],
  emphasised: boolean,
  onPress: () => void,
) {
  return { label, value: count(value), detail: [], icon, tone, emphasised, onPress, action: 'View' } satisfies Tile;
}

/** The overdue invoice first, then each module's tiles in module order; a module is named only where two tiles
 * would otherwise read the same. */
function needsAction(data: Dashboard, navigation: Navigation): Tile[] {
  const counts = data.needs_action;
  const overdue = data.overdue_invoice;
  const both = data.modules.includes('flights') && data.modules.includes('hotels');
  const tiles: Tile[] = [];
  if (overdue) {
    tiles.push({
      label: 'Overdue invoice',
      value: formatMoney(overdue.amount, overdue.currency),
      detail: [
        `${overdue.number}, due ${formatDate(overdue.due_on)}`,
        `Suspended on ${formatDate(overdue.suspends_on)} if unpaid`,
      ],
      icon: 'alert-circle-outline',
      tone: 'danger',
      emphasised: true,
      onPress: () => navigation.navigate('AdminBilling'),
      action: 'View billing',
    });
  }
  if (counts.bookings_requested !== undefined) {
    const flights = (status: 'requested' | 'paid' | 'availability_confirmed') => () =>
      navigation.navigate('AdminBookings', { status });
    tiles.push(
      tile(
        both ? 'Flight bookings to confirm' : 'Bookings to confirm',
        counts.bookings_requested,
        'checkmark-done-outline',
        'warning',
        counts.bookings_requested > 0,
        flights('requested'),
      ),
      tile(
        'Paid, boarding pass due',
        counts.bookings_paid_awaiting_boarding_pass ?? 0,
        'document-attach-outline',
        'success',
        (counts.bookings_paid_awaiting_boarding_pass ?? 0) > 0,
        flights('paid'),
      ),
      tile('Open requests', counts.open_queries ?? 0, 'chatbubbles-outline', 'info', false, () =>
        navigation.navigate('AdminRequests', { status: 'open' }),
      ),
      tile(
        both ? 'Flights awaiting payment' : 'Awaiting payment',
        counts.bookings_awaiting_payment ?? 0,
        'card-outline',
        'neutral',
        false,
        flights('availability_confirmed'),
      ),
    );
    if (counts.new_fares) {
      tiles.push(
        tile('New fares to review', counts.new_fares, 'airplane-outline', 'info', true, () =>
          navigation.navigate('AdminRoutes'),
        ),
      );
    }
  }
  if (counts.travellers_missing !== undefined) {
    tiles.push(
      tile(
        'Travellers missing this week',
        counts.travellers_missing,
        'people-outline',
        'warning',
        counts.travellers_missing > 0,
        () => navigation.navigate('AdminTours', { status: 'upcoming' }),
      ),
    );
  }
  if (counts.hotel_to_confirm !== undefined) {
    const hotels = (status: 'requested' | 'paid' | 'availability_confirmed') => () =>
      navigation.navigate('AdminHotels', { status });
    tiles.push(
      tile(
        both ? 'Hotel bookings to confirm' : 'Bookings to confirm',
        counts.hotel_to_confirm,
        'checkmark-done-outline',
        'warning',
        counts.hotel_to_confirm > 0,
        hotels('requested'),
      ),
      tile(
        both ? 'Hotels awaiting payment' : 'Awaiting payment',
        counts.hotel_awaiting_payment ?? 0,
        'card-outline',
        'neutral',
        false,
        hotels('availability_confirmed'),
      ),
      tile(
        'Paid, voucher due',
        counts.hotel_vouchers_due ?? 0,
        'document-attach-outline',
        'success',
        (counts.hotel_vouchers_due ?? 0) > 0,
        hotels('paid'),
      ),
    );
  }
  return tiles;
}

function KindIcon({ kind, shown }: { kind: Kind; shown: boolean }) {
  return shown ? (
    <View style={styles.kind}>
      <Icon name={KIND_ICONS[kind]} size={16} color={colors.tertiary} />
    </View>
  ) : null;
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.withIcon}>
      {icon}
      <View style={styles.shrink}>{children}</View>
    </View>
  );
}

function openBooking(navigation: Navigation, kind: Kind, id: string) {
  if (kind === 'flight') {
    navigation.navigate('AdminBookings', { status: 'all', id });
  } else if (kind === 'hotel') {
    navigation.navigate('AdminHotels', { status: 'all', id });
  } else {
    navigation.navigate('AdminTours', { status: 'all', id });
  }
}

function PaymentRow({
  item,
  icons,
  now,
  navigation,
}: {
  item: PaymentDue;
  icons: boolean;
  now: number;
  navigation: Navigation;
}) {
  const left = timeLeft(item.payment_deadline, now);
  return (
    <LinkRow
      label={`${icons ? `${KIND_LABELS[item.kind]}: ` : ''}${item.customer.name}, ${item.title}, ${formatPrice(item.total)}, ${left}`}
      onPress={() => openBooking(navigation, item.kind, item.id)}
      value={<Text style={styles.strong}>{formatPrice(item.total)}</Text>}
    >
      <Row icon={<KindIcon kind={item.kind} shown={icons} />}>
        <Text style={styles.strong} numberOfLines={1}>
          {item.customer.name}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {item.title} · {left}
        </Text>
      </Row>
    </LinkRow>
  );
}

function WeekRow({ item, icons, navigation }: { item: ComingUp; icons: boolean; navigation: Navigation }) {
  let heading: string;
  let line: string;
  let chip: string | null;
  if (item.kind === 'flight') {
    heading = item.customer.name;
    line = `${item.title} · ${formatDate(item.date)} · ${passengersLabel(item.passenger_count)}`;
    chip = item.boarding_passes_sent ? null : 'Passes not sent';
  } else if (item.kind === 'tour') {
    heading = item.title;
    line = `Starts ${formatDate(item.date)} · ${count(item.booked)} of ${count(item.slots)} booked`;
    chip = item.travellers_missing ? `${plural(item.travellers_missing, 'traveller')} missing` : null;
  } else {
    heading = item.customer.name;
    line = `${item.title} · ${formatDate(item.date)} · ${nightsLabel(item.nights)}, ${roomsLabel(item.rooms)}`;
    chip = item.voucher_sent ? null : 'Voucher not sent';
  }
  return (
    <LinkRow
      label={`${icons ? `${KIND_LABELS[item.kind]}: ` : ''}${heading}, ${line}${chip ? `, ${chip}` : ''}`}
      onPress={() => openBooking(navigation, item.kind, item.id)}
    >
      <Row icon={<KindIcon kind={item.kind} shown={icons} />}>
        <Text style={styles.strong} numberOfLines={1}>
          {heading}
        </Text>
        <Text style={styles.muted} numberOfLines={2}>
          {line}
        </Text>
        {chip ? (
          <View style={styles.chip}>
            <StatusChip label={chip} tone="warning" />
          </View>
        ) : null}
      </Row>
    </LinkRow>
  );
}

function TopSellers({ rows, icons, navigation }: { rows: TopSeller[]; icons: boolean; navigation: Navigation }) {
  const most = Number(rows[0]?.total ?? 0);
  return (
    <Card>
      <SectionTitle>Top sellers this year</SectionTitle>
      {rows.length === 0 ? (
        <Text style={styles.muted}>No sales this year yet.</Text>
      ) : (
        rows.map((item, index) => {
          const label = `${index + 1}. ${icons ? `${KIND_LABELS[item.kind]}: ` : ''}${item.title}: ${plural(item.count, 'booking')}, ${formatPrice(item.total)}`;
          const body = (
            <>
              <View style={styles.between}>
                <Row icon={<KindIcon kind={item.kind} shown={icons} />}>
                  <Text style={styles.strong} numberOfLines={1}>
                    {item.title}
                  </Text>
                </Row>
                <View style={styles.figures}>
                  <Text style={styles.strong}>{formatPrice(item.total)}</Text>
                  <Text style={styles.muted}>{plural(item.count, 'booking')}</Text>
                </View>
              </View>
              <ShareBar share={most ? Number(item.total) / most : 0} />
            </>
          );
          const id = item.id;
          return id ? (
            <LinkRow
              key={`${item.kind}-${id}`}
              label={label}
              onPress={() =>
                item.kind === 'tour'
                  ? navigation.navigate('AdminTours', { status: 'all', id })
                  : navigation.navigate('AdminHotels', { tab: 'hotels', id })
              }
            >
              {body}
            </LinkRow>
          ) : (
            <View key={`${item.kind}-${item.title}`} style={styles.sellerRow} accessibilityLabel={label} accessible>
              {body}
            </View>
          );
        })
      )}
    </Card>
  );
}

function OnSale({ data, navigation }: { data: Dashboard; navigation: Navigation }) {
  const { flights, tours, hotels } = data.on_sale;
  const headed = data.modules.length > 1;
  const heading = (module: Module) => (headed ? <Text style={styles.subheading}>{MODULE_LABELS[module]}</Text> : null);
  const featured = (value: number) => <Text style={styles.muted}>{count(value)} featured on Explore</Text>;
  return (
    <Card>
      <SectionTitle>On sale</SectionTitle>
      {flights ? (
        <View style={styles.block}>
          {heading('flights')}
          <LinkRow
            label={`${plural(flights.bookable, 'offer')} open for booking, ${count(flights.public_bookable)} public`}
            onPress={() => navigation.navigate('AdminOffers')}
          >
            <Text style={styles.text}>
              <Text style={styles.strong}>{count(flights.bookable)}</Text> {flights.bookable === 1 ? 'offer' : 'offers'}{' '}
              open for booking, {count(flights.public_bookable)} public
            </Text>
            {featured(flights.featured)}
          </LinkRow>
          <LinkRow
            label={`${plural(flights.expiring_soon, 'offer')} expire within 7 days`}
            onPress={() => navigation.navigate('AdminOffers')}
          >
            <Text style={flights.expiring_soon ? styles.warning : styles.text}>
              {plural(flights.expiring_soon, 'offer')} expire{flights.expiring_soon === 1 ? 's' : ''} within 7 days
            </Text>
          </LinkRow>
          {flights.searches ? (
            <LinkRow
              label={`Fare searches this month: ${flights.searches.used} of ${flights.searches.allowance}`}
              onPress={() => navigation.navigate('AdminRoutes')}
            >
              <View style={styles.between}>
                <Text style={[styles.text, styles.shrink]}>Fare searches this month</Text>
                <Text style={styles.strong}>
                  {count(flights.searches.used)} of {count(flights.searches.allowance)}
                </Text>
              </View>
              <UsageBar used={flights.searches.used} allowance={flights.searches.allowance} />
            </LinkRow>
          ) : null}
        </View>
      ) : null}
      {tours ? (
        <View style={styles.block}>
          {heading('tours')}
          <LinkRow
            label={`${plural(tours.upcoming, 'upcoming tour')}, ${count(tours.seats_sold)} of ${count(tours.seats_total)} seats sold, ${count(tours.fully_booked)} fully booked`}
            onPress={() => navigation.navigate('AdminTours', { status: 'upcoming' })}
          >
            <Text style={styles.text}>
              <Text style={styles.strong}>{count(tours.upcoming)}</Text>{' '}
              {tours.upcoming === 1 ? 'upcoming tour' : 'upcoming tours'} open for booking
            </Text>
            <View style={styles.between}>
              <Text style={[styles.text, styles.shrink]}>Seats sold</Text>
              <Text style={styles.strong}>
                {count(tours.seats_sold)} of {count(tours.seats_total)}
              </Text>
            </View>
            <ShareBar share={tours.seats_total ? tours.seats_sold / tours.seats_total : 0} />
            <Text style={styles.muted}>
              {count(tours.fully_booked)} fully booked · {count(tours.featured)} featured on Explore
            </Text>
          </LinkRow>
        </View>
      ) : null}
      {hotels ? (
        <View style={styles.block}>
          {heading('hotels')}
          <LinkRow
            label={`${plural(hotels.listed, 'hotel')} listed, ${count(hotels.prices_ending)} have prices for less than 30 days ahead`}
            onPress={() => navigation.navigate('AdminHotels', { tab: 'hotels' })}
          >
            <Text style={styles.text}>
              <Text style={styles.strong}>{count(hotels.listed)}</Text> {hotels.listed === 1 ? 'hotel' : 'hotels'}{' '}
              listed
            </Text>
            {hotels.prices_ending ? (
              <Text style={styles.warning}>
                {count(hotels.prices_ending)} {hotels.prices_ending === 1 ? 'has' : 'have'} prices for less than 30 days
                ahead
              </Text>
            ) : null}
            {featured(hotels.featured)}
          </LinkRow>
        </View>
      ) : null}
    </Card>
  );
}

const styles = createStyles(() => ({
  ...dashboardStyles,
  greeting: { fontSize: font.body, color: colors.muted, marginTop: space.xs },
  subheading: { fontSize: font.small, fontWeight: weight.bold, color: colors.muted, textTransform: 'uppercase' },
  big: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  warning: { fontSize: font.body, fontWeight: weight.semibold, color: colors.warningText },
  actions: { alignItems: 'flex-start' },
  sellerRow: { gap: space.xs, paddingVertical: space.sm },
  figures: { alignItems: 'flex-end' },
  chip: { alignSelf: 'flex-start', marginTop: 2 },
  withIcon: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, flexShrink: 1, flexGrow: 1, minWidth: 0 },
  kind: { paddingTop: 2 },
  block: { gap: 0 },
}));
