import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

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
import { Icon } from '../../components/Icon';
import { StatusChip } from '../../components/StatusChip';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { colors, font, radius, space, weight } from '../../theme';
import { BOOKING_STATUS, TERMINAL_STATUSES, changesAwaitingAcceptance, timeLeft } from '../../utils/bookings';
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
  // cancel, accept-changes or decline-changes.
  const act = useMutation({
    mutationFn: async (action: 'cancel' | 'accept-changes' | 'decline-changes') =>
      (await api.post<BookingDetail>(`/bookings/${id}/${action}`)).data,
    onSuccess: (data) => {
      queryClient.setQueryData(['bookings', 'detail', id], data);
      return queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
  });

  if (booking.isPending) {
    return <LoadingState />;
  }
  if (booking.isError) {
    return <ErrorState error={booking.error} onRetry={() => booking.refetch()} />;
  }

  const data = booking.data;
  const status = BOOKING_STATUS[data.status];
  const help = STATUS_HELP[data.status];
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
            <Button title="Request other options" variant="secondary" onPress={() => navigation.navigate('QueryNew')} />
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
        <PaymentBox deadline={data.payment_deadline} instructions={data.payment_instructions} />
      ) : null}

      <Card>
        <BookingSummary booking={data} />
      </Card>

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

/** Payment instructions and the deadline with a countdown, refreshed each minute. */
function PaymentBox({ deadline, instructions }: { deadline: string | null; instructions: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const passed = deadline !== null && new Date(deadline).getTime() <= now;

  return (
    <View style={styles.payment}>
      <View style={styles.paymentTitle}>
        <Icon name="card-outline" size={22} color={colors.primary} />
        <Text style={styles.section}>Seats confirmed: please pay</Text>
      </View>
      {deadline ? (
        <View style={styles.deadlineRow}>
          <Text style={styles.deadline}>Pay by {formatDateTime(deadline)}</Text>
          <View style={[styles.countdown, passed && styles.countdownPassed]}>
            <Icon name="time-outline" size={14} color={passed ? colors.dangerText : colors.warningText} />
            <Text style={[styles.countdownText, passed && styles.countdownTextPassed]}>{timeLeft(deadline, now)}</Text>
          </View>
        </View>
      ) : null}
      <Text style={styles.instructions}>{instructions}</Text>
      <Text style={styles.muted}>If payment is not received by the deadline, the hold on these seats lapses.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  payment: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
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
  deadlineRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  countdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.warningTint,
  },
  countdownPassed: { backgroundColor: colors.dangerTint },
  countdownText: { fontSize: font.small, fontWeight: weight.bold, color: colors.warningText },
  countdownTextPassed: { color: colors.dangerText },
  instructions: { fontSize: font.body, color: colors.text, padding: space.md, borderRadius: radius.sm, backgroundColor: colors.surface },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  section: { fontSize: font.heading, fontWeight: weight.bold, color: colors.tertiary },
  deadline: { color: colors.text, fontWeight: weight.bold },
  actions: { flexDirection: 'row' },
  text: { color: colors.text },
  muted: { color: colors.muted },
});
