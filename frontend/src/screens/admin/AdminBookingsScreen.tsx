import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { AdminBooking, BookingStatus, Paginated } from '../../api/types';
import { Button } from '../../components/Button';
import { DetailLayout } from '../../components/DetailLayout';
import { Icon } from '../../components/Icon';
import { Pagination } from '../../components/Pagination';
import { PriceTag } from '../../components/PriceTag';
import { RouteLine } from '../../components/RouteLine';
import { Screen } from '../../components/Screen';
import { SegmentedControl } from '../../components/SegmentedControl';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { Column, RouteCell, Table, TableRow, TwoLineCell } from '../../components/Table';
import { TripCard } from '../../components/TripCard';
import { AdminTabParamList } from '../../navigation/types';
import { colors, font, space, useIsWide, weight } from '../../theme';
import { BOOKING_STATUS, bookingRoute, passengersLabel } from '../../utils/bookings';
import { formatDate, formatDateTime } from '../../utils/format';
import { AdminBookingDetailView } from './AdminBookingDetailView';
import { NewBookingDialog } from './NewBookingDialog';
import { useListPage, useMissingPageReset } from '../../utils/listPage';

const STATUS_OPTIONS: { value: BookingStatus | 'all'; label: string }[] = [
  { value: 'requested', label: 'Requested' },
  { value: 'availability_confirmed', label: 'Awaiting payment' },
  { value: 'paid', label: 'Paid' },
  { value: 'completed', label: 'Completed' },
  { value: 'unavailable', label: 'Unavailable' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired' },
  { value: 'declined', label: 'Declined' },
  { value: 'all', label: 'All' },
];

const COLUMNS: Column[] = [
  { label: 'Customer', flex: 2 },
  { label: 'Route', flex: 2 },
  { label: 'Departure', flex: 1.6 },
  { label: 'Passengers', flex: 1.2 },
  { label: 'Total', flex: 1.4 },
  { label: 'Status', flex: 1.6 },
  { label: 'Booked', flex: 1.6 },
];

export function AdminBookingsScreen({ navigation, route }: BottomTabScreenProps<AdminTabParamList, 'AdminBookings'>) {
  const selected = route.params?.id;
  const close = useCallback(() => navigation.setParams({ id: undefined }), [navigation]);
  // With a booking open the list is too narrow for the table.
  const asTable = useIsWide() && selected === undefined;
  const status = route.params?.status ?? 'requested';
  const [page, setPage] = useListPage(status);
  const [creating, setCreating] = useState(false);
  const bookings = useQuery({
    queryKey: ['admin', 'bookings', status, page],
    queryFn: async () => {
      const params = { page, ...(status === 'all' ? {} : { status }) };
      return (await api.get<Paginated<AdminBooking>>('/admin/bookings', { params })).data;
    },
    placeholderData: keepPreviousData,
  });
  useMissingPageReset(bookings.error, page, setPage);
  const open = (booking: AdminBooking) => navigation.setParams({ id: booking.id });

  return (
    <DetailLayout
      title="Booking"
      backLabel="All bookings"
      onClose={close}
      detail={selected ? <AdminBookingDetailView key={selected} id={selected} /> : null}
      list={
        <Screen card>
          <View style={styles.header}>
            <Text style={styles.title}>Bookings</Text>
            <Button title="New booking" icon="add" onPress={() => setCreating(true)} />
          </View>
          <NewBookingDialog
            open={creating}
            onClose={() => setCreating(false)}
            onCreated={(booking) => {
              setCreating(false);
              // New bookings start as requested: show that list with the booking open.
              setPage(1);
              navigation.setParams({ status: 'requested', id: booking.id });
            }}
          />
          <SegmentedControl
            label="Status"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(value) => {
              setPage(1);
              navigation.setParams({ status: value });
            }}
            wrap
          />
          {bookings.isPending ? (
            <LoadingState />
          ) : bookings.isError ? (
            <ErrorState error={bookings.error} onRetry={() => bookings.refetch()} />
          ) : bookings.data.results.length === 0 ? (
            <EmptyState icon="ticket-outline" title="Nothing here" message="No bookings here." />
          ) : (
            <>
              {asTable ? (
                <Table columns={COLUMNS}>
                  {bookings.data.results.map((booking) => (
                    <BookingTableRow key={booking.id} booking={booking} onPress={() => open(booking)} />
                  ))}
                </Table>
              ) : (
                <View style={styles.cards}>
                  {bookings.data.results.map((booking) => (
                    <AdminBookingCard
                      key={booking.id}
                      booking={booking}
                      selected={booking.id === selected}
                      onPress={() => open(booking)}
                    />
                  ))}
                </View>
              )}
              <Pagination page={page} count={bookings.data.count} onChange={setPage} />
            </>
          )}
        </Screen>
      }
    />
  );
}

function BookingTableRow({ booking, onPress }: { booking: AdminBooking; onPress: () => void }) {
  const status = BOOKING_STATUS[booking.status];
  return (
    <TableRow
      columns={COLUMNS}
      onPress={onPress}
      accessibilityLabel={`${booking.user.full_name}, ${bookingRoute(booking)}, ${status.label}`}
      cells={[
        <TwoLineCell key="customer" primary={booking.user.full_name} secondary={booking.user.email} />,
        <RouteCell key="route" origin={booking.offer.origin} destination={booking.offer.destination} />,
        formatDate(booking.offer.departure_date),
        passengersLabel(booking.passenger_count),
        <PriceTag key="total" amount={booking.total_price} />,
        <StatusChip key="status" label={status.label} tone={status.tone} />,
        <Text key="booked" style={styles.small}>
          {formatDateTime(booking.created_at)}
        </Text>,
      ]}
    />
  );
}

function AdminBookingCard({
  booking,
  selected,
  onPress,
}: {
  booking: AdminBooking;
  selected: boolean;
  onPress: () => void;
}) {
  const status = BOOKING_STATUS[booking.status];
  const { offer } = booking;
  return (
    <TripCard
      tone={status.tone}
      selected={selected}
      onPress={onPress}
      accessibilityLabel={`${booking.user.full_name}, ${bookingRoute(booking)}, ${status.label}`}
    >
      <View style={styles.between}>
        <Text style={styles.customer} numberOfLines={1}>
          {booking.user.full_name}
        </Text>
        <StatusChip label={status.label} tone={status.tone} />
      </View>
      <RouteLine origin={offer.origin} destination={offer.destination} stopCount={booking.stop_count} />
      <View style={styles.between}>
        <View style={styles.facts}>
          <View style={styles.fact}>
            <Icon name="calendar-outline" size={16} color={colors.muted} />
            <Text style={styles.text}>{formatDate(offer.departure_date)}</Text>
          </View>
          <View style={styles.fact}>
            <Icon name="people-outline" size={16} color={colors.muted} />
            <Text style={styles.text}>{passengersLabel(booking.passenger_count)}</Text>
          </View>
        </View>
        <PriceTag amount={booking.total_price} />
      </View>
      <Text style={styles.small}>Booked {formatDateTime(booking.created_at)}</Text>
    </TripCard>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  cards: { gap: space.md },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  customer: { flexShrink: 1, fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  text: { fontSize: font.body, color: colors.text },
  small: { fontSize: font.small, color: colors.muted },
});
