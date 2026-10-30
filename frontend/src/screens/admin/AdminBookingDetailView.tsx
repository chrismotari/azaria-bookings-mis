import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { AdminBookingDetail, BoardingPass, BookingStatus } from '../../api/types';
import { BoardingPassList } from '../../components/BoardingPassList';
import { BookingSummary } from '../../components/BookingSummary';
import { BookingTimeline } from '../../components/BookingTimeline';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FileField } from '../../components/FileField';
import { FormError } from '../../components/Field';
import { StatusChip } from '../../components/StatusChip';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { colors } from '../../theme';
import { BOOKING_STATUS } from '../../utils/bookings';
import { confirmAction } from '../../utils/confirm';
import { formatDateTime } from '../../utils/format';

type Action = {
  path: 'confirm-availability' | 'mark-unavailable' | 'mark-paid' | 'complete';
  title: string;
  confirm: string;
  variant: 'primary' | 'danger';
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
  variant: 'danger',
};
const MARK_PAID: Action = {
  path: 'mark-paid',
  title: 'Mark paid',
  confirm: 'Only do this once the payment has reached you. The customer will be emailed a receipt.',
  variant: 'primary',
};

const SEND_PASSES: Action = {
  path: 'complete',
  title: 'Send boarding passes',
  confirm: 'The customer will be emailed every file listed. Files cannot be changed afterwards.',
  variant: 'primary',
};

// Mirrors the server's upload rules.
const MAX_PASSES = 10;
const MAX_SIZE = 5 * 1024 * 1024;
const ACCEPT = '.pdf,.png,.jpg,.jpeg';
const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

/** Why the file cannot be uploaded, or null. */
function fileProblem(file: File): string | null {
  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  if (!['pdf', 'png', 'jpg', 'jpeg'].includes(extension) || !ALLOWED_TYPES.includes(file.type)) {
    return `${file.name}: upload a PDF, PNG or JPEG file.`;
  }
  if (file.size > MAX_SIZE) {
    return `${file.name}: the file is larger than 5 MB.`;
  }
  return null;
}

// The admin actions valid from each status.
const ACTIONS: Partial<Record<BookingStatus, Action[]>> = {
  requested: [CONFIRM_AVAILABILITY, MARK_UNAVAILABLE],
  availability_confirmed: [MARK_PAID, MARK_UNAVAILABLE],
};

export function AdminBookingDetailView({ id }: { id: number }) {
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
    <>
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

      {data.status === 'paid' ? (
        <BoardingPassUploads
          booking={data}
          onSend={() => run(SEND_PASSES)}
          sending={act.isPending && act.variables?.path === 'complete'}
        />
      ) : null}
      {data.status === 'completed' ? (
        <Card>
          <Text style={styles.section}>Boarding passes sent</Text>
          <BoardingPassList passes={data.boarding_passes} />
        </Card>
      ) : null}

      <Card>
        <Text style={styles.section}>Timeline</Text>
        <BookingTimeline events={data.events} />
      </Card>
    </>
  );
}

type UploadsProps = { booking: AdminBookingDetail; onSend: () => void; sending: boolean };

/** Paid bookings: upload, list and delete boarding passes, then send them. */
function BoardingPassUploads({ booking, onSend, sending }: UploadsProps) {
  const queryClient = useQueryClient();
  const [problems, setProblems] = useState<string[]>([]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'bookings', 'detail', booking.id] });

  const upload = useMutation({
    // One file per request, as the API expects.
    mutationFn: async (files: File[]) => {
      const failed: string[] = [];
      for (const file of files) {
        const body = new FormData();
        body.append('file', file);
        try {
          await api.post(`/admin/bookings/${booking.id}/boarding-passes`, body);
        } catch (error) {
          failed.push(`${file.name}: ${errorMessage(error)}`);
        }
      }
      return failed;
    },
    onSuccess: (failed) => setProblems(failed),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: async (boardingPass: BoardingPass) => api.delete(`/admin/boarding-passes/${boardingPass.id}`),
    onSettled: refresh,
  });

  const onSelect = (files: File[]) => {
    const rejected = files.map(fileProblem).filter((problem): problem is string => problem !== null);
    const accepted = files.filter((file) => fileProblem(file) === null);
    const room = MAX_PASSES - booking.boarding_passes.length;
    if (accepted.length > room) {
      rejected.push(`A booking can have at most ${MAX_PASSES} boarding passes.`);
    }
    setProblems(rejected);
    if (accepted.length && room > 0) {
      upload.mutate(accepted.slice(0, room));
    }
  };
  const onDelete = async (boardingPass: BoardingPass) => {
    if (await confirmAction('Delete this file?', boardingPass.original_name, 'Delete')) {
      remove.mutate(boardingPass);
    }
  };

  const passes = booking.boarding_passes;
  return (
    <Card>
      <Text style={styles.section}>Boarding passes</Text>
      <Text style={styles.muted}>
        Upload one file per passenger if needed: PDF, PNG or JPEG, up to 5 MB each, at most {MAX_PASSES} files.
      </Text>
      <FileField
        label="Add files"
        accept={ACCEPT}
        onSelect={onSelect}
        disabled={upload.isPending || passes.length >= MAX_PASSES}
      />
      {upload.isPending ? <Text style={styles.muted}>Uploading…</Text> : null}
      {problems.map((problem) => (
        <FormError key={problem} message={problem} />
      ))}
      <FormError message={remove.isError ? errorMessage(remove.error) : null} />
      {passes.length ? (
        <BoardingPassList
          passes={passes}
          onDelete={onDelete}
          deletingId={remove.isPending ? remove.variables?.id : null}
        />
      ) : (
        <Text style={styles.muted}>No files uploaded yet.</Text>
      )}
      <View style={styles.actions}>
        <Button
          title="Send boarding passes"
          onPress={onSend}
          disabled={passes.length === 0 || upload.isPending}
          loading={sending}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  section: { fontSize: 18, fontWeight: '700', color: colors.tertiary },
  deadline: { color: colors.text, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  text: { color: colors.text },
  muted: { color: colors.muted },
});
