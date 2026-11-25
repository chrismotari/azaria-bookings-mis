import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { HotelBooking, HotelBookingStatus, Paginated } from '../../api/types';
import { BoardingPassList } from '../../components/BoardingPassList';
import { BookingProgress } from '../../components/BookingProgress';
import { BookingTimeline } from '../../components/BookingTimeline';
import { ReviewCard } from '../../components/Reviews';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useConfirm } from '../../components/ConfirmDialog';
import { DetailError, DetailLayout } from '../../components/DetailLayout';
import { FormError } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { Pagination } from '../../components/Pagination';
import { PaymentBox } from '../../components/PaymentBox';
import { PriceTag } from '../../components/PriceTag';
import { Screen } from '../../components/Screen';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { MainTabParamList } from '../../navigation/types';
import { colors, createStyles, font, radius, space, weight } from '../../theme';
import { BOOKING_STATUS, TERMINAL_STATUSES } from '../../utils/bookings';
import { openHotelVoucher } from '../../utils/download';
import { formatDate, formatDateTime, formatPrice } from '../../utils/format';
import { HOTEL_EVENT_LABELS, roomsLabel, stayDates, timeLabel } from '../../utils/hotels';
import { HotelBookingCard, HotelRooms } from './HotelBookingParts';

type Props = BottomTabScreenProps<MainTabParamList, 'Bookings'>;

const STATUS_HELP: Partial<Record<HotelBookingStatus, string>> = {
  requested: 'We are checking availability with the hotel and will email you shortly.',
  paid: 'Payment received. We will email your hotel voucher once the hotel confirms your rooms.',
  completed: 'Your stay is confirmed. Show the voucher at check-in.',
  expired: 'This booking expired before it was paid, or before the hotel could confirm it.',
  declined: 'You declined the new total, so this booking has ended.',
};

/** The customer's Bookings › Hotels. */
export function HotelBookingsPage({ navigation, route }: Props) {
  const selected = route.params?.hotel;
  const close = useCallback(() => navigation.setParams({ hotel: undefined }), [navigation]);
  const [page, setPage] = useState(1);
  const bookings = useQuery({
    queryKey: ['hotel-bookings', page],
    queryFn: async () => (await api.get<Paginated<HotelBooking>>('/hotel-bookings', { params: { page } })).data,
    placeholderData: keepPreviousData,
  });

  return (
    <DetailLayout
      title="Hotel booking"
      backLabel="All hotel bookings"
      onClose={close}
      selected={selected}
      rail={{
        title: 'Hotel bookings',
        items: bookings.data?.results.map((booking) => ({
          id: booking.id,
          primary: booking.hotel.name,
          secondary: formatDate(booking.check_in),
          accessibilityLabel: `${booking.hotel.name}, ${BOOKING_STATUS[booking.status].label}`,
        })),
        onSelect: (id) => navigation.setParams({ hotel: id }),
        page,
        count: bookings.data?.count,
        onPage: setPage,
      }}
      detail={
        selected ? (
          <HotelBookingDetailView
            key={selected}
            id={selected}
            onOpenHotel={(id) => navigation.navigate('HotelDetail', { id })}
          />
        ) : null
      }
      list={
        <Screen maxWidth={900} card>
          <Text style={styles.title}>My hotel bookings</Text>
          {bookings.isPending ? (
            <LoadingState />
          ) : bookings.isError ? (
            <ErrorState error={bookings.error} onRetry={() => bookings.refetch()} />
          ) : bookings.data.results.length === 0 ? (
            <EmptyState
              icon="bed-outline"
              title="No hotel bookings yet"
              message="You have no hotel bookings yet. Find a hotel on Explore and request a booking."
            />
          ) : (
            <>
              <View style={styles.list}>
                {bookings.data.results.map((booking) => (
                  <HotelBookingCard
                    key={booking.id}
                    booking={booking}
                    selected={booking.id === selected}
                    onPress={() => navigation.setParams({ hotel: booking.id })}
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

function HotelBookingDetailView({ id, onOpenHotel }: { id: string; onOpenHotel: (id: string) => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const queryKey = ['hotel-bookings', 'detail', id] as const;
  const booking = useQuery({
    queryKey,
    queryFn: async () => (await api.get<HotelBooking>(`/hotel-bookings/${id}`)).data,
  });
  const act = useMutation({
    mutationFn: async (action: 'cancel' | 'accept-changes' | 'decline-changes') =>
      (await api.post<HotelBooking>(`/hotel-bookings/${id}/${action}`)).data,
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['hotel-bookings'] }),
  });

  if (booking.isPending) {
    return <LoadingState />;
  }
  if (booking.isError) {
    return <DetailError error={booking.error} onRetry={() => booking.refetch()} notFound="Booking not found" />;
  }
  const data = booking.data;
  const status = BOOKING_STATUS[data.status];
  const help =
    data.status === 'unavailable'
      ? data.unavailable_message || 'Sorry, the hotel has no rooms for these dates.'
      : STATUS_HELP[data.status];
  const awaiting = data.status === 'availability_confirmed' && data.changes !== null && !data.changes_accepted;
  const onCancel = async () => {
    if (
      await confirm({
        title: 'Cancel this booking?',
        message: 'This cannot be undone.',
        confirmLabel: 'Cancel booking',
        tone: 'danger',
      })
    ) {
      act.mutate('cancel');
    }
  };
  const onDecline = async () => {
    if (
      await confirm({
        title: 'Decline the new total?',
        message: 'This ends the booking.',
        confirmLabel: 'Decline',
        tone: 'danger',
      })
    ) {
      act.mutate('decline-changes');
    }
  };

  return (
    <>
      <Card>
        <View style={styles.between}>
          <Text style={styles.muted}>Requested {formatDateTime(data.created_at)}</Text>
          {TERMINAL_STATUSES.includes(data.status) ? null : <StatusChip label={status.label} tone={status.tone} />}
        </View>
        <BookingProgress status={data.status} message={help} />
        {help && !TERMINAL_STATUSES.includes(data.status) ? <Text style={styles.text}>{help}</Text> : null}
      </Card>
      <ReviewCard
        kind="hotel"
        bookingId={data.id}
        canReview={data.can_review}
        review={data.review}
        bookingsKey={['hotel-bookings']}
      />

      {awaiting && data.changes ? (
        <View style={styles.changes}>
          <View style={styles.row}>
            <Icon name="create-outline" size={22} color={colors.warningText} />
            <Text style={styles.heading}>The price has changed</Text>
          </View>
          <Text style={styles.text}>
            The hotel has rooms, but at another total. Please accept it before you pay, or decline it to end the
            booking.
          </Text>
          <View style={styles.row}>
            <Text style={styles.old}>{formatPrice(data.changes.total.old)}</Text>
            <Icon name="arrow-forward" size={14} color={colors.muted} label="changed to" />
            <Text style={styles.strong}>{formatPrice(data.changes.total.new)}</Text>
          </View>
          {data.changes.note ? <Text style={styles.text}>{data.changes.note}</Text> : null}
          {data.payment_deadline ? (
            <Text style={styles.muted}>
              The hold lasts until {formatDateTime(data.payment_deadline)}, including the time to accept and pay.
            </Text>
          ) : null}
          <View style={styles.row}>
            <Button
              title="Accept new total"
              onPress={() => act.mutate('accept-changes')}
              loading={act.isPending && act.variables === 'accept-changes'}
              disabled={act.isPending}
            />
            <Button
              title="Decline"
              variant="danger"
              onPress={onDecline}
              loading={act.isPending && act.variables === 'decline-changes'}
              disabled={act.isPending}
            />
          </View>
        </View>
      ) : data.status === 'availability_confirmed' ? (
        <PaymentBox
          title="Rooms confirmed: please pay"
          deadline={data.payment_deadline}
          instructions={data.payment_instructions}
          lapse="If payment is not received by the deadline, the hold on these rooms lapses."
        />
      ) : null}

      {data.status === 'completed' ? (
        <Card>
          <Text style={styles.heading}>Your voucher</Text>
          <Text style={styles.text}>
            Hotel confirmation number: <Text style={styles.strong}>{data.hotel_confirmation}</Text>
          </Text>
          <Text style={styles.muted}>We have also emailed it to you.</Text>
          <BoardingPassList passes={data.vouchers} openFile={openHotelVoucher} />
        </Card>
      ) : null}

      <Card>
        <Text style={styles.heading}>{data.hotel.name}</Text>
        <Text style={styles.text}>
          {data.hotel.address}, {data.hotel.destination}
        </Text>
        <Text style={styles.text}>{stayDates(data.check_in, data.check_out)}</Text>
        <Text style={styles.muted}>
          Check-in from {timeLabel(data.hotel.check_in_time)} · Check-out by {timeLabel(data.hotel.check_out_time)}
        </Text>
        <View style={styles.start}>
          <Button title="View the hotel" variant="link" onPress={() => onOpenHotel(data.hotel.id)} />
        </View>
      </Card>

      <Card>
        <Text style={styles.heading}>Rooms and guests</Text>
        <HotelRooms booking={data} editable={data.can_edit_guests} base={`/hotel-bookings/${id}`} queryKey={queryKey} />
        {data.special_requests ? <Text style={styles.text}>Special requests: {data.special_requests}</Text> : null}
        {data.notes ? <Text style={styles.text}>Notes: {data.notes}</Text> : null}
        <View style={styles.between}>
          <View>
            <Text style={styles.heading}>Total</Text>
            <Text style={styles.muted}>{roomsLabel(data.rooms.length)}</Text>
          </View>
          <PriceTag amount={data.total} size="large" />
        </View>
        {data.can_edit_guests ? (
          <Text style={styles.muted}>You can change the guests until the agency confirms availability.</Text>
        ) : null}
      </Card>

      <Card>
        <Text style={styles.heading}>Cancellation policy</Text>
        <Text style={styles.text}>{data.hotel.cancellation_policy}</Text>
      </Card>

      <Card>
        <Text style={styles.heading}>History</Text>
        <BookingTimeline events={data.events} labels={HOTEL_EVENT_LABELS} />
      </Card>

      <FormError message={act.isError ? errorMessage(act.error) : null} />
      {data.can_cancel ? (
        <View style={styles.start}>
          <Button
            title="Cancel booking"
            variant="danger"
            onPress={onCancel}
            loading={act.isPending && act.variables === 'cancel'}
            disabled={act.isPending}
          />
        </View>
      ) : null}
    </>
  );
}

const styles = createStyles(() => ({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  list: { gap: space.md },
  heading: { fontSize: font.heading, fontWeight: weight.bold, color: colors.tertiary },
  text: { fontSize: font.body, color: colors.text },
  strong: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
  old: { fontSize: font.body, color: colors.muted, textDecorationLine: 'line-through' },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  start: { alignSelf: 'flex-start' },
  changes: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderLeftColor: colors.warningText,
    backgroundColor: colors.warningTint,
  },
}));
