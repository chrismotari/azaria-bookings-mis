import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { Booking, Paginated } from '../../api/types';
import { DetailLayout } from '../../components/DetailLayout';
import { Pagination } from '../../components/Pagination';
import { Screen } from '../../components/Screen';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { MainTabParamList } from '../../navigation/types';
import { colors, radius, shadow } from '../../theme';
import { BOOKING_STATUS, bookingRoute, passengersLabel } from '../../utils/bookings';
import { formatDate, formatPrice } from '../../utils/format';
import { BookingDetailView } from './BookingDetailView';

export function BookingsScreen({ navigation, route }: BottomTabScreenProps<MainTabParamList, 'Bookings'>) {
  const selected = route.params?.id;
  const close = useCallback(() => navigation.setParams({ id: undefined }), [navigation]);
  const [page, setPage] = useState(1);
  const bookings = useQuery({
    queryKey: ['bookings', page],
    queryFn: async () => (await api.get<Paginated<Booking>>('/bookings', { params: { page } })).data,
    placeholderData: keepPreviousData,
  });

  return (
    <DetailLayout
      title="Booking"
      backLabel="All bookings"
      onClose={close}
      detail={selected ? <BookingDetailView key={selected} id={selected} /> : null}
      list={
        <Screen maxWidth={900}>
          <Text style={styles.title}>My bookings</Text>
          {bookings.isPending ? (
            <LoadingState />
          ) : bookings.isError ? (
            <ErrorState error={bookings.error} onRetry={() => bookings.refetch()} />
          ) : bookings.data.results.length === 0 ? (
            <EmptyState message="You have no bookings yet. Find a deal on Explore and book it." />
          ) : (
            <>
              <View style={styles.list}>
                {bookings.data.results.map((booking) => (
                  <BookingRow
                    key={booking.id}
                    booking={booking}
                    selected={booking.id === selected}
                    onPress={() => navigation.setParams({ id: booking.id })}
                  />
                ))}
              </View>
              <Pagination page={page} count={bookings.data.count} onChange={setPage} />
            </>
          )}
        </Screen>
      }
    />
  );
}

function BookingRow({ booking, selected, onPress }: { booking: Booking; selected: boolean; onPress: () => void }) {
  const status = BOOKING_STATUS[booking.status];
  return (
    <Pressable
      accessibilityRole="link"
      aria-current={selected}
      onPress={onPress}
      style={({ pressed }) => [styles.row, (pressed || selected) && styles.pressed, selected && styles.selected]}
    >
      <View style={styles.rowMain}>
        <Text style={styles.route}>{bookingRoute(booking)}</Text>
        <Text style={styles.text}>
          {formatDate(booking.offer.departure_date)} · {booking.offer.airline} ·{' '}
          {passengersLabel(booking.passenger_count)}
        </Text>
        <Text style={styles.price}>{formatPrice(booking.total_price)}</Text>
      </View>
      <StatusChip label={status.label} tone={status.tone} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  list: { gap: 12 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    ...shadow,
  },
  pressed: { borderColor: colors.primary },
  selected: { backgroundColor: colors.primaryTint },
  rowMain: { flexShrink: 1, gap: 2 },
  route: { fontSize: 16, fontWeight: '700', color: colors.text },
  text: { color: colors.text },
  price: { color: colors.primary, fontWeight: '700' },
});
