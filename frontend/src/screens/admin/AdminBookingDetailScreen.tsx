import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { AdminBookingDetail, BookingStatus } from '../../api/types';
import { BookingSummary } from '../../components/BookingSummary';
import { BookingTimeline } from '../../components/BookingTimeline';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FormError } from '../../components/Field';
import { Screen } from '../../components/Screen';
import { StatusChip } from '../../components/StatusChip';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { RootStackParamList } from '../../navigation/types';
import { colors } from '../../theme';
import { BOOKING_STATUS } from '../../utils/bookings';
import { confirmAction } from '../../utils/confirm';
import { formatDateTime } from '../../utils/format';

type Action = {
  path: 'confirm-availability' | 'mark-unavailable' | 'mark-paid';
  title: string;
  confirm: string;
  variant: 'primary' | 'secondary';
};

const CONFIRM_AVAILABILITY: Action = {
  path: 'confirm-availability',
  title: 'Confirm availability',
  confirm: 'The customer will be emailed the payment instructions and deadline.',
  variant: 'primary',
};
const MARK_UNAVAILABLE: Action = {
  path: 'mark-unavailable',
  title: 'Mark unavailable',
  confirm: 'The customer will be told the seats are not available. This cannot be undone.',
  variant: 'secondary',
};
const MARK_PAID: Action = {
  path: 'mark-paid',
  title: 'Mark paid',
  confirm: 'Only do this once the payment has reached you. The customer will be emailed a receipt.',
  variant: 'primary',
};

// The admin actions valid from each status.
const ACTIONS: Partial<Record<BookingStatus, Action[]>> = {
  requested: [CONFIRM_AVAILABILITY, MARK_UNAVAILABLE],
  availability_confirmed: [MARK_PAID, MARK_UNAVAILABLE],
};

export function AdminBookingDetailScreen({ route }: NativeStackScreenProps<RootStackParamList, 'AdminBookingDetail'>) {
  const { id } = route.params;
  const queryClient = useQueryClient();
  const booking = useQuery({
    queryKey: ['admin', 'bookings', 'detail', id],
    queryFn: async () => (await api.get<AdminBookingDetail>(`/admin/bookings/${id}`)).data,
  });
  const act = useMutation({
    mutationFn: async (action: Action) =>
      (await api.post<AdminBookingDetail>(`/admin/bookings/${id}/${action.path}`)).data,
    onSuccess: (data) => {
      queryClient.setQueryData(['admin', 'bookings', 'detail', id], data);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'bookings'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] }),
      ]);
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
  const actions = ACTIONS[data.status] ?? [];
  const run = async (action: Action) => {
    if (await confirmAction(`${action.title}?`, action.confirm, action.title)) {
      act.mutate(action);
    }
  };

  return (
    <Screen maxWidth={900}>
      <Card>
        <View style={styles.header}>
          <Text style={styles.muted}>Booked {formatDateTime(data.created_at)}</Text>
          <StatusChip label={status.label} tone={status.tone} />
        </View>
        <BookingSummary booking={data} />
        {data.status === 'availability_confirmed' && data.payment_deadline ? (
          <Text style={styles.deadline}>Payment due by {formatDateTime(data.payment_deadline)}</Text>
        ) : null}
      </Card>

      <Card>
        <Text style={styles.section}>Customer</Text>
        <Text style={styles.text}>{data.user.full_name}</Text>
        <Text style={styles.text}>{data.user.email}</Text>
        {data.user.phone ? <Text style={styles.text}>{data.user.phone}</Text> : null}
      </Card>

      {actions.length ? (
        <View style={styles.actions}>
          {actions.map((action) => (
            <Button
              key={action.path}
              title={action.title}
              variant={action.variant}
              onPress={() => run(action)}
              disabled={act.isPending}
              loading={act.isPending && act.variables?.path === action.path}
            />
          ))}
        </View>
      ) : null}
      <FormError message={act.isError ? errorMessage(act.error) : null} />

      <Card>
        <Text style={styles.section}>Timeline</Text>
        <BookingTimeline events={data.events} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  section: { fontSize: 18, fontWeight: '700', color: colors.text },
  deadline: { color: colors.text, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  text: { color: colors.text },
  muted: { color: colors.muted },
});
