import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { AdminBookingDetail, BoardingPass, BookingStatus } from '../../api/types';
import { ActionBar } from '../../components/ActionBar';
import { BoardingPassList } from '../../components/BoardingPassList';
import { BookingSummary } from '../../components/BookingSummary';
import { BookingTimeline } from '../../components/BookingTimeline';
import { Button } from '../../components/Button';
import { BookingProgress } from '../../components/BookingProgress';
import { Card } from '../../components/Card';
import { ChangeList } from '../../components/ChangeList';
import { useConfirm } from '../../components/ConfirmDialog';
import { FileField } from '../../components/FileField';
import { FormError } from '../../components/Field';
import { ItineraryCards, TripConditions } from '../../components/Itinerary';
import { StatusChip } from '../../components/StatusChip';
import { DetailError } from '../../components/DetailLayout';
import { LoadingState } from '../../components/StatusViews';
import { colors, font, weight } from '../../theme';
import { BOOKING_STATUS, TERMINAL_STATUSES, changesAwaitingAcceptance } from '../../utils/bookings';
import { formatDateTime } from '../../utils/format';
import { ConfirmAvailabilityDialog } from './ConfirmAvailabilityDialog';
import { MarkUnavailableDialog } from './MarkUnavailableDialog';

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
  paid: [SEND_PASSES],
};

const uploadKey = (id: string) => ['admin', 'boarding-passes', 'upload', id];

export function AdminBookingDetailView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const uploading = useIsMutating({ mutationKey: uploadKey(id) }) > 0;
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<'confirm' | 'unavailable' | null>(null);
  const booking = useQuery({
    queryKey: ['admin', 'bookings', 'detail', id],
    queryFn: async () => (await api.get<AdminBookingDetail>(`/admin/bookings/${id}`)).data,
  });
  const updated = (data: AdminBookingDetail) => {
    queryClient.setQueryData(['admin', 'bookings', 'detail', id], data);
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'bookings'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] }),
    ]);
  };
  const act = useMutation({
    mutationFn: async (action: Action) =>
      (await api.post<AdminBookingDetail>(`/admin/bookings/${id}/${action.path}`)).data,
    onSuccess: updated,
    // Refused (e.g. the customer cancelled meanwhile): show what it is now.
    onError: () => queryClient.invalidateQueries({ queryKey: ['admin', 'bookings'] }),
  });

  if (booking.isPending) {
    return <LoadingState />;
  }
  if (booking.isError) {
    return <DetailError error={booking.error} onRetry={() => booking.refetch()} notFound="Booking not found" />;
  }

  const data = booking.data;
  const status = BOOKING_STATUS[data.status];
  const actions = ACTIONS[data.status] ?? [];
  const run = async (action: Action) => {
    if (action === CONFIRM_AVAILABILITY || action === MARK_UNAVAILABLE) {
      setDialog(action === CONFIRM_AVAILABILITY ? 'confirm' : 'unavailable');
      return;
    }
    if (
      await confirm({
        title: `${action.title}?`,
        message: action.confirm,
        confirmLabel: action.title,
        tone: action.variant,
      })
    ) {
      act.mutate(action);
    }
  };

  const awaitingChanges = changesAwaitingAcceptance(data);
  // Sending needs at least one uploaded file and no upload in progress; marking paid needs any changes accepted.
  const blocked = (action: Action) =>
    (action === SEND_PASSES && (data.boarding_passes.length === 0 || uploading)) ||
    (action === MARK_PAID && awaitingChanges);

  return (
    <>
      {actions.length ? (
        <ActionBar>
          {actions.map((action) => (
            <Button
              key={action.path}
              title={action.title}
              variant={action.variant}
              onPress={() => run(action)}
              disabled={act.isPending || blocked(action)}
              loading={act.isPending && act.variables?.path === action.path}
            />
          ))}
        </ActionBar>
      ) : null}
      <FormError message={act.isError ? errorMessage(act.error) : null} />
      <ConfirmAvailabilityDialog
        booking={data}
        open={dialog === 'confirm'}
        onClose={() => setDialog(null)}
        onDone={(confirmed) => {
          setDialog(null);
          updated(confirmed);
        }}
      />
      <MarkUnavailableDialog
        booking={data}
        open={dialog === 'unavailable'}
        onClose={() => setDialog(null)}
        onDone={(marked) => {
          setDialog(null);
          updated(marked);
          // Suggestions create a responded request and possibly private custom offers.
          queryClient.invalidateQueries({ queryKey: ['admin', 'queries'] });
          queryClient.invalidateQueries({ queryKey: ['admin', 'offers'] });
        }}
      />

      {data.changes ? (
        <Card>
          <Text style={styles.section}>
            {data.status === 'declined'
              ? 'Changes declined by the customer'
              : data.changes_accepted
                ? 'Changes accepted by the customer'
                : 'Changes waiting for the customer'}
          </Text>
          <ChangeList changes={data.changes} />
          {awaitingChanges ? (
            <Text style={styles.muted}>Mark paid becomes available once the customer accepts the changes.</Text>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <View style={styles.header}>
          <Text style={styles.muted}>Booked {formatDateTime(data.created_at)}</Text>
          {/* A status that ends the booking shows as the progress banner instead. */}
          {TERMINAL_STATUSES.includes(data.status) ? null : <StatusChip label={status.label} tone={status.tone} />}
        </View>
        <BookingProgress status={data.status} />
      </Card>

      <Card>
        <BookingSummary booking={data} />
        {data.status === 'availability_confirmed' && data.payment_deadline ? (
          <Text style={styles.deadline}>Payment due by {formatDateTime(data.payment_deadline)}</Text>
        ) : null}
      </Card>
      <ItineraryCards itinerary={data.itinerary} />
      <Card>
        <TripConditions trip={data} />
      </Card>

      <Card>
        <Text style={styles.section}>Customer</Text>
        <Text style={styles.text}>{data.user.full_name}</Text>
        <Text style={styles.text}>{data.user.email}</Text>
        {data.user.phone ? <Text style={styles.text}>{data.user.phone}</Text> : null}
      </Card>

      {data.status === 'paid' ? <BoardingPassUploads booking={data} /> : null}
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

/** Paid bookings: upload, list and delete boarding passes (sent from the action bar). */
function BoardingPassUploads({ booking }: { booking: AdminBookingDetail }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [problems, setProblems] = useState<string[]>([]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'bookings', 'detail', booking.id] });

  const upload = useMutation({
    mutationKey: uploadKey(booking.id),
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
    if (
      await confirm({
        title: 'Delete this file?',
        message: boardingPass.original_name,
        confirmLabel: 'Delete',
        tone: 'danger',
      })
    ) {
      remove.mutate(boardingPass);
    }
  };

  const passes = booking.boarding_passes;
  return (
    <Card>
      <Text style={styles.section}>Boarding passes</Text>
      <FileField
        label="Add files"
        hint={`Click to choose files. One per passenger if needed: PDF, PNG or JPEG, up to 5 MB each, at most ${MAX_PASSES} files.`}
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
        <Text style={styles.muted}>
          No files uploaded yet. Send boarding passes from the actions above once they are here.
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  section: { fontSize: font.heading, fontWeight: weight.bold, color: colors.tertiary },
  deadline: { color: colors.text, fontWeight: weight.bold },
  text: { color: colors.text },
  muted: { color: colors.muted },
});
