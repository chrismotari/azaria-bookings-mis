import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { AdminBooking, BookingStatus, Paginated } from '../../api/types';
import { OptionChips } from '../../components/OptionChips';
import { Pagination } from '../../components/Pagination';
import { Screen } from '../../components/Screen';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { AdminTabParamList } from '../../navigation/types';
import { colors } from '../../theme';
import { BOOKING_STATUS, bookingRoute, passengersLabel } from '../../utils/bookings';
import { formatDate, formatDateTime, formatPrice } from '../../utils/format';

const STATUS_OPTIONS: { value: BookingStatus | 'all'; label: string }[] = [
  { value: 'requested', label: 'Requested' },
  { value: 'availability_confirmed', label: 'Awaiting payment' },
  { value: 'paid', label: 'Paid' },
  { value: 'completed', label: 'Completed' },
  { value: 'unavailable', label: 'Unavailable' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired' },
  { value: 'all', label: 'All' },
];

export function AdminBookingsScreen({ navigation, route }: BottomTabScreenProps<AdminTabParamList, 'AdminBookings'>) {
  const rootNavigation = useNavigation();
  const status = route.params?.status ?? 'requested';
  const [page, setPage] = useState(1);
  const bookings = useQuery({
    queryKey: ['admin', 'bookings', status, page],
    queryFn: async () => {
      const params = { page, ...(status === 'all' ? {} : { status }) };
      return (await api.get<Paginated<AdminBooking>>('/admin/bookings', { params })).data;
    },
    placeholderData: keepPreviousData,
  });

  return (
    <Screen>
      <Text style={styles.title}>Bookings</Text>
      <OptionChips
        label="Status"
        options={STATUS_OPTIONS}
        value={status}
        onChange={(value) => {
          setPage(1);
          navigation.setParams({ status: value });
        }}
      />
      {bookings.isPending ? (
        <LoadingState />
      ) : bookings.isError ? (
        <ErrorState error={bookings.error} onRetry={() => bookings.refetch()} />
      ) : bookings.data.results.length === 0 ? (
        <EmptyState message="No bookings here." />
      ) : (
        <>
          <View style={styles.grid}>
            {bookings.data.results.map((booking) => (
              <View key={booking.id} style={styles.gridItem}>
                <AdminBookingCard
                  booking={booking}
                  onPress={() => rootNavigation.navigate('AdminBookingDetail', { id: booking.id })}
                />
              </View>
            ))}
          </View>
          <Pagination page={page} count={bookings.data.count} onChange={setPage} />
        </>
      )}
    </Screen>
  );
}

function AdminBookingCard({ booking, onPress }: { booking: AdminBooking; onPress: () => void }) {
  const status = BOOKING_STATUS[booking.status];
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.cardTop}>
        <Text style={styles.customer} numberOfLines={1}>
          {booking.user.full_name}
        </Text>
        <StatusChip label={status.label} tone={status.tone} />
      </View>
      <Text style={styles.route}>{bookingRoute(booking)}</Text>
      <Text style={styles.text}>
        {formatDate(booking.offering.departure_date)} · {passengersLabel(booking.passenger_count)} ·{' '}
        {formatPrice(booking.total_price)}
      </Text>
      <Text style={styles.muted}>Booked {formatDateTime(booking.created_at)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridItem: { flexGrow: 1, flexBasis: 340, minWidth: 0 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 4,
  },
  pressed: { borderColor: colors.primary },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  customer: { flexShrink: 1, color: colors.muted, fontWeight: '600' },
  route: { fontSize: 16, fontWeight: '700', color: colors.text },
  text: { color: colors.text },
  muted: { color: colors.muted, fontSize: 13 },
});
