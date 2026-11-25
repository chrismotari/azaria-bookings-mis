import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { BookingDetail, BookingStatus } from '../../api/types';
import { BoardingPassList } from '../../components/BoardingPassList';
import { BookingProgress } from '../../components/BookingProgress';
import { BookingSummary } from '../../components/BookingSummary';
import { BookingTimeline } from '../../components/BookingTimeline';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ChangeList } from '../../components/ChangeList';
import { useConfirm } from '../../components/ConfirmDialog';
import { FormError } from '../../components/Field';
import { ItineraryCards, TripConditions } from '../../components/Itinerary';
import { Icon } from '../../components/Icon';
import { PassengersCard } from '../../components/Passengers';
import { PaymentBox } from '../../components/PaymentBox';
import { StatusChip } from '../../components/StatusChip';
import { DetailError } from '../../components/DetailLayout';
import { LoadingState } from '../../components/StatusViews';
import { colors, createStyles, font, radius, space, weight } from '../../theme';
import { BOOKING_STATUS, TERMINAL_STATUSES, changesAwaitingAcceptance } from '../../utils/bookings';
import { formatDateTime } from '../../utils/format';

const CANCELLABLE: BookingStatus[] = ['requested', 'availability_confirmed'];

const STATUS_HELP: Partial<Record<BookingStatus, string>> = {
  requested: 'We are checking availability with the airline and will email you shortly.',
  paid: 'Payment received. We will email your boarding passes once they are ready.',
  unavailable: 'Sorry, these seats were no longer available. You can request other options.',
  expired: 'The hold lapsed because payment was not received in time. You can book again if the deal is still open.',
  declined: 'You declined the changes we made, so this booking has ended. You can book again or request other options.',
};

export function BookingDetailView({ id }: { id: string }) {
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const booking = useQuery({
    queryKey: ['bookings', 'detail', id],
    queryFn: async () => (await api.get<BookingDetail>(`/bookings/${id}`)).data,
  });
  const act = useMutation({
    mutationFn: async (action: 'cancel' | 'accept-changes' | 'decline-changes') =>
      (await api.post<BookingDetail>(`/bookings/${id}/${action}`)).data,
    onSuccess: (data) => {
      queryClient.setQueryData(['bookings', 'detail', id], data);
      return queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
    // Refused (e.g. the admin changed the booking meanwhile): show what it is now.
    onError: () => queryClient.invalidateQueries({ queryKey: ['bookings'] }),
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
    data.status === 'unavailable' && data.alternatives
      ? 'Sorry, these seats were no longer available. We have suggested other options for you to choose from.'
      : STATUS_HELP[data.status];
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
        title: 'Decline the changes?',
        message: 'This ends the booking. You can book again or request other options afterwards.',
        confirmLabel: 'Decline',
        tone: 'danger',
      })
    ) {
      act.mutate('decline-changes');
    }
  };
  const awaitingChanges = changesAwaitingAcceptance(data);

  return (
    <>
      <Card>
        <View style={styles.header}>
          <Text style={styles.muted}>Booked {formatDateTime(data.created_at)}</Text>
          {/* A status that ends the booking shows as the banner below instead. */}
          {TERMINAL_STATUSES.includes(data.status) ? null : <StatusChip label={status.label} tone={status.tone} />}
        </View>
        <BookingProgress status={data.status} message={help} />
        {help && !TERMINAL_STATUSES.includes(data.status) ? <Text style={styles.text}>{help}</Text> : null}
        {data.status === 'unavailable' ? (
          <View style={styles.actions}>
            {data.alternatives ? (
              <Button
                title="View suggested options"
                onPress={() =>
                  navigation.navigate('Main', { screen: 'Requests', params: { id: data.alternatives ?? undefined } })
                }
              />
            ) : (
              <Button
                title="Request other options"
                variant="secondary"
                onPress={() => navigation.navigate('Main', { screen: 'QueryNew' })}
              />
            )}
          </View>
        ) : null}
      </Card>

      {awaitingChanges && data.changes ? (
        <View style={styles.changes}>
          <View style={styles.paymentTitle}>
            <Icon name="create-outline" size={22} color={colors.warningText} />
            <Text style={styles.section}>We had to make some changes</Text>
          </View>
          <Text style={styles.text}>
            Seats are available, but not exactly as booked. Please accept the changes before you pay, or decline them to
            end the booking.
          </Text>
          <ChangeList changes={data.changes} />
          {data.payment_deadline ? (
            <Text style={styles.muted}>
              The hold lasts until {formatDateTime(data.payment_deadline)}, including the time to accept and pay.
            </Text>
          ) : null}
          <View style={styles.changeActions}>
            <Button
              title="Accept changes"
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
          title="Seats confirmed: please pay"
          deadline={data.payment_deadline}
          instructions={data.payment_instructions}
          lapse="If payment is not received by the deadline, the hold on these seats lapses."
        />
      ) : null}

      <Card>
        <BookingSummary booking={data} />
      </Card>
      <ItineraryCards itinerary={data.itinerary} />
      <Card>
        <TripConditions trip={data} />
      </Card>
      <PassengersCard booking={data} base={`/bookings/${id}`} queryKey={['bookings', 'detail', id]} />

      {data.status === 'completed' && data.boarding_passes ? (
        <Card>
          <Text style={styles.section}>Boarding passes</Text>
          <Text style={styles.muted}>We have also emailed these to you.</Text>
          <BoardingPassList passes={data.boarding_passes} />
        </Card>
      ) : null}

      <Card>
        <Text style={styles.section}>History</Text>
        <BookingTimeline events={data.events} />
      </Card>

      <FormError message={act.isError ? errorMessage(act.error) : null} />
      {CANCELLABLE.includes(data.status) ? (
        <View style={styles.actions}>
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
  paymentTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
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
  changeActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  section: { fontSize: font.heading, fontWeight: weight.bold, color: colors.tertiary },
  actions: { flexDirection: 'row' },
  text: { color: colors.text },
  muted: { color: colors.muted },
}));
