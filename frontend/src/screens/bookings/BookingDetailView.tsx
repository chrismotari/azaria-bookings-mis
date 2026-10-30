import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { BookingDetail, BookingStatus } from '../../api/types';
import { BoardingPassList } from '../../components/BoardingPassList';
import { BookingSummary } from '../../components/BookingSummary';
import { BookingTimeline } from '../../components/BookingTimeline';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FormError } from '../../components/Field';
import { StatusChip } from '../../components/StatusChip';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { colors } from '../../theme';
import { BOOKING_STATUS } from '../../utils/bookings';
import { confirmAction } from '../../utils/confirm';
import { formatDateTime } from '../../utils/format';

const CANCELLABLE: BookingStatus[] = ['requested', 'availability_confirmed'];

const STATUS_HELP: Partial<Record<BookingStatus, string>> = {
  requested: 'We are checking availability with the airline and will email you shortly.',
  paid: 'Payment received. We will email your boarding passes once they are ready.',
  unavailable: 'Sorry, these seats were no longer available. You can request other options.',
  expired: 'The hold lapsed because payment was not received in time. You can book again if the deal is still open.',
};

export function BookingDetailView({ id }: { id: number }) {
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const booking = useQuery({
    queryKey: ['bookings', 'detail', id],
    queryFn: async () => (await api.get<BookingDetail>(`/bookings/${id}`)).data,
  });
  const cancel = useMutation({
    mutationFn: async () => (await api.post<BookingDetail>(`/bookings/${id}/cancel`)).data,
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
    if (await confirmAction('Cancel this booking?', 'This cannot be undone.', 'Cancel booking')) {
      cancel.mutate();
    }
  };

  return (
    <>
      <Card>
        <View style={styles.header}>
          <Text style={styles.muted}>Booked {formatDateTime(data.created_at)}</Text>
          <StatusChip label={status.label} tone={status.tone} />
        </View>
        <BookingSummary booking={data} />
        {help ? <Text style={styles.text}>{help}</Text> : null}
        {data.status === 'unavailable' ? (
          <View style={styles.actions}>
            <Button title="Request other options" variant="secondary" onPress={() => navigation.navigate('QueryNew')} />
          </View>
        ) : null}
      </Card>

      {data.status === 'availability_confirmed' ? (
        <Card>
          <Text style={styles.section}>Seats confirmed: please pay</Text>
          {data.payment_deadline ? (
            <Text style={styles.deadline}>Pay by {formatDateTime(data.payment_deadline)}</Text>
          ) : null}
          <Text style={styles.text}>{data.payment_instructions}</Text>
          <Text style={styles.muted}>If payment is not received by the deadline, the hold on these seats lapses.</Text>
        </Card>
      ) : null}

      {data.status === 'completed' && data.boarding_passes ? (
        <Card>
          <Text style={styles.section}>Boarding passes</Text>
          <Text style={styles.muted}>We have also emailed these to you.</Text>
          <BoardingPassList passes={data.boarding_passes} />
        </Card>
      ) : null}

      <Card>
        <Text style={styles.section}>Timeline</Text>
        <BookingTimeline events={data.events} />
      </Card>

      <FormError message={cancel.isError ? errorMessage(cancel.error) : null} />
      {CANCELLABLE.includes(data.status) ? (
        <View style={styles.actions}>
          <Button title="Cancel booking" variant="danger" onPress={onCancel} loading={cancel.isPending} />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  section: { fontSize: 18, fontWeight: '700', color: colors.tertiary },
  deadline: { color: colors.danger, fontWeight: '700' },
  actions: { flexDirection: 'row' },
  text: { color: colors.text },
  muted: { color: colors.muted },
});
