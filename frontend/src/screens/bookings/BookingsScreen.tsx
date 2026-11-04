import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { Booking, Paginated } from '../../api/types';
import { AirlineBadge } from '../../components/AirlineBadge';
import { DetailLayout } from '../../components/DetailLayout';
import { Icon, IconName } from '../../components/Icon';
import { Pagination } from '../../components/Pagination';
import { PriceTag } from '../../components/PriceTag';
import { RouteLine } from '../../components/RouteLine';
import { Screen } from '../../components/Screen';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { TripCard } from '../../components/TripCard';
import { MainTabParamList } from '../../navigation/types';
import { colors, font, space, weight } from '../../theme';
import { BOOKING_STATUS, bookingRoute, passengersLabel } from '../../utils/bookings';
import { formatDate } from '../../utils/format';
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
        <Screen maxWidth={900} card>
          <Text style={styles.title}>My bookings</Text>
          {bookings.isPending ? (
            <LoadingState />
          ) : bookings.isError ? (
            <ErrorState error={bookings.error} onRetry={() => bookings.refetch()} />
          ) : bookings.data.results.length === 0 ? (
            <EmptyState
              icon="ticket-outline"
              title="No bookings yet"
              message="You have no bookings yet. Find a deal on Explore and book it."
            />
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
  const { offer } = booking;
  return (
    <TripCard
      tone={status.tone}
      selected={selected}
      onPress={onPress}
      accessibilityLabel={`${bookingRoute(booking)}, ${formatDate(offer.departure_date)}, ${status.label}`}
    >
      <View style={styles.between}>
        <View style={styles.airline}>
          <AirlineBadge airline={offer.airline} />
          <Text style={styles.airlineName} numberOfLines={1}>
            {offer.airline.name}
          </Text>
        </View>
        <StatusChip label={status.label} tone={status.tone} />
      </View>
      <RouteLine origin={offer.origin} destination={offer.destination} stopCount={booking.stop_count} />
      <View style={styles.between}>
        <View style={styles.facts}>
          <Fact icon="calendar-outline" text={formatDate(offer.departure_date)} />
          <Fact icon="people-outline" text={passengersLabel(booking.passenger_count)} />
        </View>
        <PriceTag amount={booking.total_price} />
      </View>
    </TripCard>
  );
}

function Fact({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.fact}>
      <Icon name={icon} size={16} color={colors.muted} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  list: { gap: space.md },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.sm },
  airline: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1, minWidth: 0 },
  airlineName: { fontSize: font.body, fontWeight: weight.bold, color: colors.text, flexShrink: 1 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  text: { fontSize: font.body, color: colors.text },
});
