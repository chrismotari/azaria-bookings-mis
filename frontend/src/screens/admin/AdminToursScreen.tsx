import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Image, Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { AdminCustomer, AdminTour, AdminTourBooking, Paginated, TourNotice } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DetailError, DetailLayout } from '../../components/DetailLayout';
import { FeatureStar } from '../../components/FeatureStar';
import { AdminRatingLink } from '../../components/Reviews';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/Field';
import { Pagination } from '../../components/Pagination';
import { PriceTag } from '../../components/PriceTag';
import { RichText } from '../../components/rich/RichText';
import { Screen } from '../../components/Screen';
import { SegmentedControl } from '../../components/SegmentedControl';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { Column, Table, TableRow, TwoLineCell } from '../../components/Table';
import { TextField } from '../../components/TextField';
import { Toggle } from '../../components/Toggle';
import { AdminTabParamList, AdminTourFilter } from '../../navigation/types';
import { colors, createStyles, font, radius, space, useIsWide, weight } from '../../theme';
import { formatDate, formatDateTime, formatPrice, todayInNairobi } from '../../utils/format';
import { adminTourStatus, peopleLabel, TOUR_BOOKING_STATUS, tourDates, unitPrice } from '../../utils/tours';
import { TourBookingLines, TourBookingTimeline } from '../tours/TourBookingParts';
import { CustomerPicker } from './NewBookingDialog';

type Props = BottomTabScreenProps<AdminTabParamList, 'AdminTours'>;

const FILTERS: { value: AdminTourFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'cancelled', label: 'Cancelled' },
];

const COLUMNS: Column[] = [
  { label: 'Featured', flex: 0.8 },
  { label: 'Tour', flex: 3 },
  { label: 'Dates', flex: 2.4 },
  { label: 'Booked / slots', flex: 1.3 },
  { label: 'From', flex: 1.2 },
  { label: 'Status', flex: 1.3 },
];

export function AdminToursScreen({ navigation, route }: Props) {
  const isWide = useIsWide();
  const selected = route.params?.id;
  const status = route.params?.status ?? 'all';
  const close = useCallback(() => navigation.setParams({ id: undefined, booking: undefined }), [navigation]);
  const [page, setPage] = useState(1);
  const [featured, setFeatured] = useState(false);
  const queryClient = useQueryClient();
  const tours = useQuery({
    queryKey: ['admin', 'tours', status, featured, page],
    queryFn: async () => {
      const params = { page, ...(status === 'all' ? {} : { status }), ...(featured ? { featured: 'true' } : {}) };
      return (await api.get<Paginated<AdminTour>>('/admin/tours', { params })).data;
    },
    placeholderData: keepPreviousData,
  });
  const feature = useMutation({
    mutationFn: ({ id, is_featured }: { id: string; is_featured: boolean }) =>
      api.patch(`/admin/tours/${id}`, { is_featured }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['admin', 'tours'] }),
  });
  const star = (tour: AdminTour) => (
    <FeatureStar
      featured={tour.is_featured}
      disabled={Boolean(tour.cancelled_at) || (feature.isPending && feature.variables?.id === tour.id)}
      onChange={(is_featured) => feature.mutate({ id: tour.id, is_featured })}
    />
  );
  const open = (id: string) => navigation.setParams({ id, booking: undefined });

  return (
    <DetailLayout
      title={route.params?.booking ? 'Tour booking' : 'Tour'}
      backLabel="All tours"
      onClose={close}
      selected={selected}
      rail={{
        title: 'Tours',
        items: tours.data?.results.map((tour) => ({
          id: tour.id,
          primary: tour.title,
          secondary: formatDate(tour.start_date),
          accessibilityLabel: `${tour.title}, ${adminTourStatus(tour).label}`,
        })),
        onSelect: open,
        page,
        count: tours.data?.count,
        onPage: setPage,
      }}
      detail={
        selected ? (
          route.params?.booking ? (
            <AdminTourBookingView
              key={route.params.booking}
              id={route.params.booking}
              onBack={() => navigation.setParams({ booking: undefined })}
            />
          ) : (
            <AdminTourDetailView
              key={selected}
              id={selected}
              onEdit={() => navigation.navigate('AdminTourEdit', { id: selected })}
              onOpenBooking={(booking) => navigation.setParams({ booking })}
              onBookFor={(customer) => navigation.navigate('AdminTourBook', { id: selected, customer: customer.id })}
              onOpenReviews={() => navigation.navigate('AdminReviews', { tour: selected })}
            />
          )
        ) : null
      }
      list={
        <Screen card>
          <View style={styles.between}>
            <Text style={styles.title}>Tours</Text>
            <Button title="New tour" onPress={() => navigation.navigate('AdminTourNew')} />
          </View>
          <SegmentedControl
            label="Show"
            options={FILTERS}
            value={status}
            wrap
            onChange={(value) => {
              navigation.setParams({ status: value });
              setPage(1);
            }}
          />
          <Toggle
            label="Featured only"
            value={featured}
            onChange={(value) => {
              setFeatured(value);
              setPage(1);
            }}
          />
          <FormError message={feature.isError ? errorMessage(feature.error) : null} />
          {tours.isPending ? (
            <LoadingState />
          ) : tours.isError ? (
            <ErrorState error={tours.error} onRetry={() => tours.refetch()} />
          ) : tours.data.results.length === 0 ? (
            <EmptyState
              icon="map-outline"
              title="No tours"
              message={status === 'all' && !featured ? 'Create your first tour.' : 'No tours match this filter.'}
            />
          ) : isWide ? (
            <Table columns={COLUMNS}>
              {tours.data.results.map((tour) => {
                const state = adminTourStatus(tour);
                return (
                  <TableRow
                    key={tour.id}
                    columns={COLUMNS}
                    selected={tour.id === selected}
                    onPress={() => open(tour.id)}
                    accessibilityLabel={`${tour.title}, ${state.label}`}
                    cells={[
                      <View key="featured">{star(tour)}</View>,
                      <TwoLineCell key="tour" primary={tour.title} secondary={tour.destination} />,
                      <TwoLineCell
                        key="dates"
                        primary={`${formatDate(tour.start_date)} – ${formatDate(tour.end_date)}`}
                        secondary={`${tour.duration_days} day${tour.duration_days === 1 ? '' : 's'}`}
                      />,
                      `${tour.booked} / ${tour.slots}`,
                      tour.from_price ? formatPrice(tour.from_price) : '—',
                      <StatusChip key="status" label={state.label} tone={state.tone} />,
                    ]}
                  />
                );
              })}
            </Table>
          ) : (
            <View style={styles.cards}>
              {tours.data.results.map((tour) => {
                const state = adminTourStatus(tour);
                return (
                  <Card key={tour.id} selected={tour.id === selected}>
                    <View style={styles.between}>
                      <Text style={[styles.strong, styles.shrink]}>{tour.title}</Text>
                      <StatusChip label={state.label} tone={state.tone} />
                    </View>
                    <Text style={styles.muted}>{tourDates(tour)}</Text>
                    <Text style={styles.text}>
                      {tour.booked} / {tour.slots} booked
                      {tour.from_price ? ` · from ${formatPrice(tour.from_price)}` : ''}
                    </Text>
                    <View style={styles.cardActions}>
                      <Button title="Open" variant="secondary" onPress={() => open(tour.id)} />
                      {star(tour)}
                    </View>
                  </Card>
                );
              })}
            </View>
          )}
          {tours.data ? <Pagination page={page} count={tours.data.count} onChange={setPage} /> : null}
        </Screen>
      }
    />
  );
}

type DetailProps = {
  id: string;
  onEdit: () => void;
  onOpenBooking: (id: string) => void;
  onBookFor: (customer: AdminCustomer) => void;
  onOpenReviews: () => void;
};

function AdminTourDetailView({ id, onEdit, onOpenBooking, onBookFor, onOpenReviews }: DetailProps) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<'cancel' | 'book' | null>(null);
  const [bookingsPage, setBookingsPage] = useState(1);
  const tour = useQuery({
    queryKey: ['admin', 'tours', 'detail', id],
    queryFn: async () => (await api.get<AdminTour>(`/admin/tours/${id}`)).data,
  });
  const bookings = useQuery({
    queryKey: ['admin', 'tours', 'bookings', id, bookingsPage],
    queryFn: async () =>
      (await api.get<Paginated<AdminTourBooking>>(`/admin/tours/${id}/bookings`, { params: { page: bookingsPage } }))
        .data,
    placeholderData: keepPreviousData,
  });
  const notices = useQuery({
    queryKey: ['admin', 'tours', 'notices', id],
    queryFn: async () => (await api.get<TourNotice[]>(`/admin/tours/${id}/notices`)).data,
  });
  const setActive = useMutation({
    mutationFn: async (is_active: boolean) => (await api.patch<AdminTour>(`/admin/tours/${id}`, { is_active })).data,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['admin', 'tours'] }),
  });

  if (tour.isPending) {
    return <LoadingState />;
  }
  if (tour.isError) {
    return <DetailError error={tour.error} onRetry={() => tour.refetch()} notFound="Tour not found" />;
  }
  const data = tour.data;
  const state = adminTourStatus(data);
  const cancelled = Boolean(data.cancelled_at);
  const started = data.start_date <= todayInNairobi();

  return (
    <>
      <Card>
        <View style={styles.between}>
          <Text style={[styles.heading, styles.shrink]}>{data.title}</Text>
          <StatusChip label={state.label} tone={state.tone} />
        </View>
        <Text style={styles.text}>{data.destination}</Text>
        <Text style={styles.text}>{tourDates(data)}</Text>
        <AdminRatingLink rating={data.rating} onPress={onOpenReviews} />
        {cancelled ? (
          <Text style={styles.danger}>
            Cancelled {formatDateTime(data.cancelled_at ?? '')}
            {data.cancelled_by ? ` by ${data.cancelled_by}` : ''}
          </Text>
        ) : (
          <View style={styles.actions}>
            <Button title="Edit" onPress={onEdit} />
            <Button
              title={data.is_active ? 'Deactivate' : 'Activate'}
              variant="secondary"
              loading={setActive.isPending}
              onPress={() => setActive.mutate(!data.is_active)}
            />
            {data.is_active && !started ? (
              <Button title="Book for a customer" variant="secondary" onPress={() => setDialog('book')} />
            ) : null}
            <Button title="Cancel tour" variant="danger" onPress={() => setDialog('cancel')} />
          </View>
        )}
        <FormError message={setActive.isError ? errorMessage(setActive.error) : null} />
      </Card>

      <Card>
        <Text style={styles.heading}>Details</Text>
        <Fact label="Booked" value={`${data.booked} of ${data.slots} slots (${data.slots_left} left)`} />
        <Fact label="Last day to book" value={formatDate(data.booking_deadline)} />
        <Fact label="Last day to cancel" value={formatDate(data.cancellation_deadline)} />
        <Fact label="Meeting point" value={data.meeting_point || '—'} />
        <Fact label="From price" value={data.from_price ? `${formatPrice(data.from_price)} per person` : '—'} />
        <Fact label="Summary" value={data.summary} />
        <RichText html={data.description} />
        <Fact label="Included" value={data.included.join('\n') || '—'} />
        <Fact label="Not included" value={data.not_included.join('\n') || '—'} />
        <Fact label="Cancellation policy" value={data.cancellation_policy} />
      </Card>

      <Card>
        <Text style={styles.heading}>Price options</Text>
        {data.options.map((option) => (
          <View key={option.id} style={styles.row}>
            <View style={styles.shrink}>
              <Text style={styles.strong}>
                {option.name}
                {option.is_active ? '' : ' (inactive)'}
              </Text>
              <Text style={styles.muted}>
                {unitPrice(option)}
                {option.description ? ` · ${option.description}` : ''}
              </Text>
            </View>
            <Text style={styles.text}>
              {option.units_sold} sold
              {option.units_available !== null ? ` of ${option.units_available}` : ''}
            </Text>
          </View>
        ))}
      </Card>

      <Card>
        <Text style={styles.heading}>Photos</Text>
        {data.photos.length ? (
          <View style={styles.photos}>
            {data.photos.map((photo, index) => (
              <Image
                key={photo.id}
                source={{ uri: photo.url }}
                style={styles.photo}
                accessibilityLabel={index === 0 ? 'Cover photo' : `Photo ${index + 1}`}
              />
            ))}
          </View>
        ) : (
          <Text style={styles.muted}>No photos yet.</Text>
        )}
      </Card>

      <Card>
        <Text style={styles.heading}>Bookings</Text>
        {bookings.isPending ? (
          <LoadingState />
        ) : bookings.isError ? (
          <ErrorState error={bookings.error} onRetry={() => bookings.refetch()} />
        ) : bookings.data.results.length === 0 ? (
          <Text style={styles.muted}>No bookings yet.</Text>
        ) : (
          <>
            {bookings.data.results.map((booking) => {
              const status = TOUR_BOOKING_STATUS[booking.status];
              return (
                <View key={booking.id} style={styles.row}>
                  <View style={styles.shrink}>
                    <Text style={styles.strong}>{booking.group_name || booking.user.full_name}</Text>
                    <Text style={styles.muted}>
                      {[booking.group_name ? booking.user.full_name : '', booking.user.phone]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                    <Text style={styles.muted}>
                      {booking.lines.map((line) => `${line.quantity} × ${line.option_name}`).join(', ')} ·{' '}
                      {peopleLabel(booking.people)} · {booking.travellers_added} of {booking.people} travellers added
                    </Text>
                    <Text style={styles.muted}>Booked {formatDateTime(booking.created_at)}</Text>
                  </View>
                  <View style={styles.rowEnd}>
                    <StatusChip label={status.label} tone={status.tone} />
                    <Button title="Open" variant="link" onPress={() => onOpenBooking(booking.id)} />
                  </View>
                </View>
              );
            })}
            <Pagination page={bookingsPage} count={bookings.data.count} onChange={setBookingsPage} />
          </>
        )}
      </Card>

      <Card>
        <Text style={styles.heading}>Notices</Text>
        {notices.data?.length ? (
          notices.data.map((notice) => (
            <View key={notice.id} style={styles.notice}>
              <Text style={styles.strong}>
                {notice.kind === 'cancellation' ? 'Cancellation' : 'Change'} · {formatDateTime(notice.created_at)}
              </Text>
              <Text style={styles.text}>{notice.message}</Text>
              <Text style={styles.muted}>
                Sent by {notice.sent_by ?? 'a former admin'} to {notice.recipients} booking
                {notice.recipients === 1 ? '' : 's'}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.muted}>No messages sent about this tour.</Text>
        )}
      </Card>

      {dialog === 'cancel' ? <CancelTourDialog tour={data} onClose={() => setDialog(null)} /> : null}
      {dialog === 'book' ? (
        <BookForCustomerDialog
          onClose={() => setDialog(null)}
          onContinue={(customer) => {
            setDialog(null);
            onBookFor(customer);
          }}
        />
      ) : null}
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function CancelTourDialog({ tour, onClose }: { tour: AdminTour; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | undefined>();
  const cancel = useMutation({
    mutationFn: () => api.post(`/admin/tours/${tour.id}/cancel`, { message: message.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'tours'] });
      onClose();
    },
  });
  const count = tour.confirmed_bookings;
  return (
    <Dialog
      open
      title="Cancel tour"
      onClose={onClose}
      busy={cancel.isPending}
      error={cancel.isError ? errorMessage(cancel.error) : null}
      footer={
        <>
          <Button title="Keep the tour" variant="secondary" onPress={onClose} disabled={cancel.isPending} />
          <Button
            title="Cancel tour"
            variant="danger"
            loading={cancel.isPending}
            onPress={() => {
              if (!message.trim()) {
                setError('Tell the customers why the tour is cancelled.');
                return;
              }
              cancel.mutate();
            }}
          />
        </>
      }
    >
      <Text style={styles.text}>
        {count
          ? `${count} booking${count === 1 ? '' : 's'} will be cancelled, and each customer emailed this message.`
          : 'There are no confirmed bookings on this tour.'}{' '}
        A cancelled tour cannot be edited or reactivated.
      </Text>
      <TextField
        label="Message to the customers"
        value={message}
        onChangeText={(text) => {
          setMessage(text);
          setError(undefined);
        }}
        error={error}
        multiline
        numberOfLines={4}
        maxLength={2000}
      />
    </Dialog>
  );
}

function BookForCustomerDialog({
  onClose,
  onContinue,
}: {
  onClose: () => void;
  onContinue: (customer: AdminCustomer) => void;
}) {
  const [customer, setCustomer] = useState<AdminCustomer | null>(null);
  const [error, setError] = useState<string | undefined>();
  return (
    <Dialog
      open
      title="Book for a customer"
      size="large"
      onClose={onClose}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} />
          <Button title="Continue" onPress={() => (customer ? onContinue(customer) : setError('Choose a customer.'))} />
        </>
      }
    >
      <Text style={styles.text}>The customer is emailed the booking, as if they had booked themselves.</Text>
      <CustomerPicker
        value={customer}
        onChange={(chosen) => {
          setCustomer(chosen);
          setError(undefined);
        }}
        error={error}
      />
    </Dialog>
  );
}

function AdminTourBookingView({ id, onBack }: { id: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const queryKey = ['admin', 'tour-bookings', id] as const;
  const booking = useQuery({
    queryKey,
    queryFn: async () => (await api.get<AdminTourBooking>(`/admin/tour-bookings/${id}`)).data,
  });

  if (booking.isPending) {
    return <LoadingState />;
  }
  if (booking.isError) {
    return <DetailError error={booking.error} onRetry={() => booking.refetch()} notFound="Booking not found" />;
  }
  const data = booking.data;
  const status = TOUR_BOOKING_STATUS[data.status];

  return (
    <>
      <View style={styles.start}>
        <Button title="← Back to the tour" variant="link" onPress={onBack} />
      </View>
      <Card>
        <View style={styles.between}>
          <Text style={[styles.heading, styles.shrink]}>{data.tour.title}</Text>
          <StatusChip label={status.label} tone={status.tone} />
        </View>
        <Text style={styles.muted}>
          {tourDates(data.tour)} · booked {formatDateTime(data.created_at)}
          {data.created_by ? ` by ${data.created_by}` : ''}
        </Text>
        {data.can_cancel ? (
          <View style={styles.start}>
            <Button title="Cancel booking" variant="danger" onPress={() => setCancelling(true)} />
          </View>
        ) : null}
      </Card>
      <Card>
        <Text style={styles.heading}>Booker</Text>
        <Fact label="Name" value={data.user.full_name} />
        <Fact label="Email" value={data.user.email} />
        <Fact label="Phone" value={data.user.phone || '—'} />
      </Card>
      {data.status === 'cancelled' ? (
        <Card>
          <Text style={styles.heading}>
            Cancelled by {data.cancelled_by === 'customer' ? 'the customer' : 'the agency'}
          </Text>
          {data.cancel_reason ? <Text style={styles.text}>{data.cancel_reason}</Text> : null}
        </Card>
      ) : null}
      <Card>
        <Text style={styles.heading}>Options and travellers</Text>
        <TourBookingLines booking={data} base={`/admin/tour-bookings/${id}`} queryKey={queryKey} />
        <Fact label="Group name" value={data.group_name || '—'} />
        <Fact label="Notes" value={data.notes || '—'} />
        <View style={styles.between}>
          <Text style={styles.heading}>Total · {peopleLabel(data.people)}</Text>
          <PriceTag amount={data.total_price} size="large" />
        </View>
      </Card>
      <Card>
        <Text style={styles.heading}>Timeline</Text>
        <TourBookingTimeline events={data.events} />
      </Card>
      {cancelling ? (
        <CancelBookingDialog
          booking={data}
          onClose={() => setCancelling(false)}
          onDone={(updated) => {
            queryClient.setQueryData(queryKey, updated);
            void queryClient.invalidateQueries({ queryKey: ['admin', 'tours'] });
            setCancelling(false);
          }}
        />
      ) : null}
    </>
  );
}

function CancelBookingDialog({
  booking,
  onClose,
  onDone,
}: {
  booking: AdminTourBooking;
  onClose: () => void;
  onDone: (booking: AdminTourBooking) => void;
}) {
  const [message, setMessage] = useState('');
  const cancel = useMutation({
    mutationFn: async () =>
      (await api.post<AdminTourBooking>(`/admin/tour-bookings/${booking.id}/cancel`, { message: message.trim() })).data,
    onSuccess: onDone,
  });
  return (
    <Dialog
      open
      title="Cancel booking"
      onClose={onClose}
      busy={cancel.isPending}
      error={cancel.isError ? errorMessage(cancel.error) : null}
      footer={
        <>
          <Button title="Keep the booking" variant="secondary" onPress={onClose} disabled={cancel.isPending} />
          <Button title="Cancel booking" variant="danger" loading={cancel.isPending} onPress={() => cancel.mutate()} />
        </>
      }
    >
      <Text style={styles.text}>
        {booking.user.full_name}'s {peopleLabel(booking.people)} are released. With a message, the customer is emailed
        it; without one, nobody is emailed.
      </Text>
      <TextField
        label="Message to the customer (optional)"
        value={message}
        onChangeText={setMessage}
        multiline
        numberOfLines={4}
        maxLength={2000}
      />
    </Dialog>
  );
}

const styles = createStyles(() => ({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  heading: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  text: { fontSize: font.body, color: colors.text },
  strong: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
  danger: { fontSize: font.body, color: colors.dangerText, fontWeight: weight.semibold },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  shrink: { flexShrink: 1, minWidth: 0 },
  start: { alignSelf: 'flex-start' },
  cardActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  cards: { gap: space.md },
  actions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    flexWrap: 'wrap',
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  fact: { gap: 2 },
  label: { fontSize: font.small, fontWeight: weight.semibold, color: colors.muted },
  value: { fontSize: font.body, color: colors.text },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  photo: { width: 120, height: 84, borderRadius: radius.md, backgroundColor: colors.neutralTint },
  notice: { gap: 2, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
}));
