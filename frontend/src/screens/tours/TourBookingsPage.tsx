import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { Paginated, TourBooking } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useConfirm } from '../../components/ConfirmDialog';
import { DetailError, DetailLayout } from '../../components/DetailLayout';
import { FormError } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { Pagination } from '../../components/Pagination';
import { PriceTag } from '../../components/PriceTag';
import { Screen } from '../../components/Screen';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { MainTabParamList } from '../../navigation/types';
import { colors, createStyles, font, radius, space, weight } from '../../theme';
import { formatDate, formatDateTime } from '../../utils/format';
import { peopleLabel, TOUR_BOOKING_STATUS, tourDates } from '../../utils/tours';
import { TourBookingCard, TourBookingLines, TourBookingTimeline } from './TourBookingParts';

type Props = BottomTabScreenProps<MainTabParamList, 'Bookings'>;

/** The customer's Bookings › Tours. */
export function TourBookingsPage({ navigation, route }: Props) {
  const selected = route.params?.tour;
  const close = useCallback(() => navigation.setParams({ tour: undefined, booked: undefined }), [navigation]);
  const [page, setPage] = useState(1);
  const bookings = useQuery({
    queryKey: ['tour-bookings', page],
    queryFn: async () => (await api.get<Paginated<TourBooking>>('/tour-bookings', { params: { page } })).data,
    placeholderData: keepPreviousData,
  });

  return (
    <DetailLayout
      title="Tour booking"
      backLabel="All tour bookings"
      onClose={close}
      selected={selected}
      rail={{
        title: 'Tour bookings',
        items: bookings.data?.results.map((booking) => ({
          id: booking.id,
          primary: booking.tour.title,
          secondary: formatDate(booking.tour.start_date),
          accessibilityLabel: `${booking.tour.title}, ${TOUR_BOOKING_STATUS[booking.status].label}`,
        })),
        onSelect: (id) => navigation.setParams({ tour: id, booked: undefined }),
        page,
        count: bookings.data?.count,
        onPage: setPage,
      }}
      detail={
        selected ? (
          <TourBookingDetailView
            key={selected}
            id={selected}
            justBooked={route.params?.booked === 'yes'}
            onOpenTour={(id) => navigation.navigate('TourDetail', { id })}
          />
        ) : null
      }
      list={
        <Screen maxWidth={900} card>
          <Text style={styles.title}>My tour bookings</Text>
          {bookings.isPending ? (
            <LoadingState />
          ) : bookings.isError ? (
            <ErrorState error={bookings.error} onRetry={() => bookings.refetch()} />
          ) : bookings.data.results.length === 0 ? (
            <EmptyState
              icon="map-outline"
              title="No tour bookings yet"
              message="You have no tour bookings yet. Find a tour on Explore and book it."
            />
          ) : (
            <>
              <View style={styles.list}>
                {bookings.data.results.map((booking) => (
                  <TourBookingCard
                    key={booking.id}
                    booking={booking}
                    selected={booking.id === selected}
                    onPress={() => navigation.setParams({ tour: booking.id, booked: undefined })}
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

function TourBookingDetailView({
  id,
  justBooked,
  onOpenTour,
}: {
  id: string;
  justBooked: boolean;
  onOpenTour: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const queryKey = ['tour-bookings', 'detail', id] as const;
  const booking = useQuery({
    queryKey,
    queryFn: async () => (await api.get<TourBooking>(`/tour-bookings/${id}`)).data,
  });
  const cancel = useMutation({
    mutationFn: async () => (await api.post<TourBooking>(`/tour-bookings/${id}/cancel`)).data,
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tour-bookings'] }),
  });

  if (booking.isPending) {
    return <LoadingState />;
  }
  if (booking.isError) {
    return <DetailError error={booking.error} onRetry={() => booking.refetch()} notFound="Booking not found" />;
  }
  const data = booking.data;
  const status = TOUR_BOOKING_STATUS[data.status];
  const onCancel = async () => {
    if (
      await confirm({
        title: 'Cancel this booking?',
        message: 'Your places are released. This cannot be undone.',
        confirmLabel: 'Cancel booking',
        tone: 'danger',
      })
    ) {
      cancel.mutate();
    }
  };

  return (
    <>
      {justBooked && data.status === 'confirmed' ? (
        <View style={styles.banner} role="status">
          <Icon name="checkmark-circle" size={22} color={colors.successText} />
          <Text style={styles.bannerText}>You're booked! We have emailed you the details.</Text>
        </View>
      ) : null}
      <Card>
        <View style={styles.between}>
          <Text style={styles.muted}>Booked {formatDateTime(data.created_at)}</Text>
          <StatusChip label={status.label} tone={status.tone} />
        </View>
        <Text style={styles.heading}>{data.tour.title}</Text>
        <Text style={styles.text}>
          {data.tour.destination} · {tourDates(data.tour)}
        </Text>
        {data.tour.meeting_point ? <Text style={styles.text}>Meeting point: {data.tour.meeting_point}</Text> : null}
        <View style={styles.link}>
          <Button title="View the tour" variant="link" onPress={() => onOpenTour(data.tour.id)} />
        </View>
      </Card>
      {data.status === 'cancelled' && data.cancelled_by === 'admin' ? (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>
            {data.tour.cancelled_at ? 'The agency cancelled this tour' : 'The agency cancelled this booking'}
          </Text>
          {data.cancel_reason ? <Text style={styles.text}>{data.cancel_reason}</Text> : null}
        </View>
      ) : null}
      <Card>
        <Text style={styles.heading}>What you booked</Text>
        <TourBookingLines booking={data} base={`/tour-bookings/${id}`} queryKey={queryKey} />
        {data.group_name ? <Text style={styles.text}>Group: {data.group_name}</Text> : null}
        {data.notes ? <Text style={styles.text}>Notes: {data.notes}</Text> : null}
        <View style={styles.between}>
          <View>
            <Text style={styles.heading}>Total</Text>
            <Text style={styles.muted}>{peopleLabel(data.people)}</Text>
          </View>
          <PriceTag amount={data.total_price} size="large" />
        </View>
        {data.can_edit_travellers ? (
          <Text style={styles.muted}>You can add or change the travellers' details until the tour.</Text>
        ) : null}
      </Card>
      {data.payment_instructions !== null ? (
        <View style={styles.payment}>
          <Text style={styles.heading}>How to pay</Text>
          <Text style={styles.text}>{data.payment_instructions || 'The agency will tell you how to pay.'}</Text>
        </View>
      ) : null}
      <Card>
        <Text style={styles.heading}>Cancellation policy</Text>
        <Text style={styles.text}>{data.tour.cancellation_policy}</Text>
        <Text style={styles.strong}>Free to cancel until {formatDate(data.tour.cancellation_deadline)}</Text>
        <FormError message={cancel.isError ? errorMessage(cancel.error) : null} />
        {data.can_cancel ? (
          <View style={styles.link}>
            <Button title="Cancel booking" variant="danger" onPress={onCancel} loading={cancel.isPending} />
          </View>
        ) : null}
      </Card>
      <Card>
        <Text style={styles.heading}>Timeline</Text>
        <TourBookingTimeline events={data.events} />
      </Card>
    </>
  );
}

const styles = createStyles(() => ({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  list: { gap: space.md },
  heading: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  text: { fontSize: font.body, color: colors.text },
  strong: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  link: { alignSelf: 'flex-start' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.successTint,
  },
  bannerText: { color: colors.successText, fontWeight: weight.bold, flexShrink: 1 },
  notice: { gap: space.xs, padding: space.lg, borderRadius: radius.md, backgroundColor: colors.dangerTint },
  noticeTitle: { fontSize: font.body, fontWeight: weight.bold, color: colors.dangerText },
  payment: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
}));
