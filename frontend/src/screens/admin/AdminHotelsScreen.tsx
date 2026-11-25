import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { keepPreviousData, useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Image, Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import {
  AdminCustomer,
  AdminHotel,
  AdminHotelBooking,
  Hotel,
  HotelBookingStatus,
  HotelVoucher,
  Paginated,
} from '../../api/types';
import { ActionBar } from '../../components/ActionBar';
import { BoardingPassList } from '../../components/BoardingPassList';
import { BookingProgress } from '../../components/BookingProgress';
import { BookingTimeline } from '../../components/BookingTimeline';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useConfirm } from '../../components/ConfirmDialog';
import { DetailError, DetailLayout } from '../../components/DetailLayout';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/Field';
import { FileField } from '../../components/FileField';
import { Pagination } from '../../components/Pagination';
import { PriceTag } from '../../components/PriceTag';
import { RichText } from '../../components/rich/RichText';
import { Screen } from '../../components/Screen';
import { SegmentedControl } from '../../components/SegmentedControl';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { Column, Table, TableRow, TwoLineCell } from '../../components/Table';
import { TextField } from '../../components/TextField';
import { AdminTabParamList } from '../../navigation/types';
import { colors, createStyles, font, radius, space, useIsWide, weight } from '../../theme';
import { BOOKING_STATUS, TERMINAL_STATUSES } from '../../utils/bookings';
import { openHotelVoucher } from '../../utils/download';
import { formatDate, formatDateTime, formatPrice } from '../../utils/format';
import { guestsLabel, HOTEL_EVENT_LABELS, roomsLabel, starsLabel, stayDates, timeLabel } from '../../utils/hotels';
import { useListPage, useMissingPageReset } from '../../utils/listPage';
import { useDebounced } from '../../utils/useDebounced';
import { HotelBookingCard, HotelRooms } from '../hotels/HotelBookingParts';
import { ACCEPT, fileProblem } from './AdminBookingDetailView';
import { CustomerPicker } from './NewBookingDialog';

type Props = BottomTabScreenProps<AdminTabParamList, 'AdminHotels'>;

const TABS: { value: 'bookings' | 'hotels'; label: string }[] = [
  { value: 'bookings', label: 'Bookings' },
  { value: 'hotels', label: 'Hotels' },
];

/** Admin › Hotels: the hotel bookings (default) and the hotels themselves. */
export function AdminHotelsScreen(props: Props) {
  return props.route.params?.tab === 'hotels' ? <HotelsTab {...props} /> : <BookingsTab {...props} />;
}

function TabSwitch({
  value,
  onChange,
}: {
  value: 'bookings' | 'hotels';
  onChange: (tab: 'bookings' | 'hotels') => void;
}) {
  return (
    <View style={styles.tabs}>
      <SegmentedControl label="Hotels" options={TABS} value={value} onChange={onChange} />
    </View>
  );
}

// Bookings

const STATUS_OPTIONS: { value: HotelBookingStatus | 'all'; label: string }[] = [
  { value: 'requested', label: 'Requested' },
  { value: 'availability_confirmed', label: 'Awaiting payment' },
  { value: 'paid', label: 'Paid' },
  { value: 'completed', label: 'Completed' },
  { value: 'unavailable', label: 'Unavailable' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired' },
  { value: 'declined', label: 'Declined' },
  { value: 'all', label: 'All' },
];

const BOOKING_COLUMNS: Column[] = [
  { label: 'Hotel', flex: 2 },
  { label: 'Guest', flex: 2 },
  { label: 'Dates', flex: 2.4 },
  { label: 'Rooms', flex: 1 },
  { label: 'Total', flex: 1.3 },
  { label: 'Status', flex: 1.5 },
];

function BookingsTab({ navigation, route }: Props) {
  const isWide = useIsWide();
  const selected = route.params?.id;
  const status = route.params?.status ?? 'requested';
  const close = useCallback(() => navigation.setParams({ id: undefined }), [navigation]);
  const [page, setPage] = useListPage(status);
  const [creating, setCreating] = useState(false);
  const bookings = useQuery({
    queryKey: ['admin', 'hotel-bookings', status, page],
    queryFn: async () => {
      const params = { page, ...(status === 'all' ? {} : { status }) };
      return (await api.get<Paginated<AdminHotelBooking>>('/admin/hotel-bookings', { params })).data;
    },
    placeholderData: keepPreviousData,
  });
  useMissingPageReset(bookings.error, page, setPage);
  const open = (id: string) => navigation.setParams({ id });

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
          primary: booking.user.email,
          secondary: formatDate(booking.check_in),
          accessibilityLabel: `${booking.user.full_name}, ${booking.hotel.name}, ${BOOKING_STATUS[booking.status].label}`,
        })),
        onSelect: open,
        page,
        count: bookings.data?.count,
        onPage: setPage,
      }}
      detail={selected ? <AdminHotelBookingView key={selected} id={selected} /> : null}
      list={
        <Screen card>
          <TabSwitch value="bookings" onChange={() => navigation.setParams({ tab: 'hotels', id: undefined })} />
          <View style={styles.between}>
            <Text style={styles.title}>Hotel bookings</Text>
            <Button title="New booking" icon="add" onPress={() => setCreating(true)} />
          </View>
          <SegmentedControl
            label="Status"
            options={STATUS_OPTIONS}
            value={status}
            wrap
            onChange={(value) => {
              setPage(1);
              navigation.setParams({ status: value });
            }}
          />
          {bookings.isPending ? (
            <LoadingState />
          ) : bookings.isError ? (
            <ErrorState error={bookings.error} onRetry={() => bookings.refetch()} />
          ) : bookings.data.results.length === 0 ? (
            <EmptyState icon="bed-outline" title="Nothing here" message="No hotel bookings here." />
          ) : (
            <>
              {isWide ? (
                <Table columns={BOOKING_COLUMNS}>
                  {bookings.data.results.map((booking) => {
                    const state = BOOKING_STATUS[booking.status];
                    return (
                      <TableRow
                        key={booking.id}
                        columns={BOOKING_COLUMNS}
                        selected={booking.id === selected}
                        onPress={() => open(booking.id)}
                        accessibilityLabel={`${booking.user.full_name}, ${booking.hotel.name}, ${state.label}`}
                        cells={[
                          <TwoLineCell
                            key="hotel"
                            primary={booking.hotel.name}
                            secondary={booking.hotel.destination}
                          />,
                          <TwoLineCell key="guest" primary={booking.user.full_name} secondary={booking.user.email} />,
                          stayDates(booking.check_in, booking.check_out),
                          String(booking.rooms.length),
                          <PriceTag key="total" amount={booking.total} />,
                          <StatusChip key="status" label={state.label} tone={state.tone} />,
                        ]}
                      />
                    );
                  })}
                </Table>
              ) : (
                <View style={styles.cards}>
                  {bookings.data.results.map((booking) => (
                    <View key={booking.id} style={styles.cardWrap}>
                      <Text style={styles.muted}>{booking.user.full_name}</Text>
                      <HotelBookingCard
                        booking={booking}
                        selected={booking.id === selected}
                        onPress={() => open(booking.id)}
                      />
                    </View>
                  ))}
                </View>
              )}
              <Pagination page={page} count={bookings.data.count} onChange={setPage} />
            </>
          )}
          {creating ? (
            <NewHotelBookingDialog
              onClose={() => setCreating(false)}
              onContinue={(hotel, customer) => {
                setCreating(false);
                navigation.navigate('AdminHotelBook', { id: hotel, customer: customer.id });
              }}
            />
          ) : null}
        </Screen>
      }
    />
  );
}

function NewHotelBookingDialog({
  onClose,
  onContinue,
}: {
  onClose: () => void;
  onContinue: (hotel: string, customer: AdminCustomer) => void;
}) {
  const [customer, setCustomer] = useState<AdminCustomer | null>(null);
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [errors, setErrors] = useState<{ customer?: string; hotel?: string }>({});
  return (
    <Dialog
      open
      title="New hotel booking"
      size="large"
      onClose={onClose}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} />
          <Button
            title="Continue"
            onPress={() => {
              setErrors({
                customer: customer ? undefined : 'Choose a customer.',
                hotel: hotel ? undefined : 'Choose a hotel.',
              });
              if (customer && hotel) {
                onContinue(hotel.id, customer);
              }
            }}
          />
        </>
      }
    >
      <Text style={styles.text}>
        Then fill in the booking for them. It starts as requested, and the customer is emailed as it moves on.
      </Text>
      <CustomerPicker
        value={customer}
        onChange={(chosen) => {
          setCustomer(chosen);
          setErrors({ ...errors, customer: undefined });
        }}
        error={errors.customer}
      />
      <HotelPicker
        value={hotel}
        onChange={(chosen) => {
          setHotel(chosen);
          setErrors({ ...errors, hotel: undefined });
        }}
        error={errors.hotel}
      />
    </Dialog>
  );
}

/** Search of the hotels customers can book, by name or destination. */
function HotelPicker({
  value,
  onChange,
  error,
}: {
  value: Hotel | null;
  onChange: (hotel: Hotel | null) => void;
  error?: string;
}) {
  const [text, setText] = useState('');
  const search = useDebounced(text.trim(), 250);
  const results = useQuery({
    queryKey: ['hotels', 'picker', search],
    queryFn: async () =>
      (await api.get<Paginated<Hotel>>('/hotels', { params: { ordering: 'name', ...(search ? { search } : {}) } }))
        .data,
    enabled: value === null,
    placeholderData: keepPreviousData,
  });
  if (value) {
    return (
      <View style={styles.picked}>
        <Text style={[styles.text, styles.shrink]}>
          {value.name} · {value.destination}
        </Text>
        <Button title="Change" variant="link" onPress={() => onChange(null)} />
      </View>
    );
  }
  const shown = results.data?.results.slice(0, 6) ?? [];
  return (
    <View style={styles.picker}>
      <TextField
        label="Hotel"
        value={text}
        onChangeText={setText}
        placeholder="Search hotels by name or destination"
        error={error}
      />
      {results.data && shown.length === 0 ? <Text style={styles.muted}>No bookable hotels match.</Text> : null}
      {shown.map((item) => (
        <View key={item.id} style={styles.listRow}>
          <View style={styles.shrink}>
            <Text style={styles.strong}>{item.name}</Text>
            <Text style={styles.muted}>{item.destination}</Text>
          </View>
          <Button title="Choose" variant="link" onPress={() => onChange(item)} />
        </View>
      ))}
    </View>
  );
}

type Action = 'confirm' | 'unavailable' | 'paid' | 'voucher';

const ACTIONS: Partial<Record<HotelBookingStatus, { action: Action; title: string; variant: 'primary' | 'danger' }[]>> =
  {
    requested: [
      { action: 'confirm', title: 'Confirm availability', variant: 'primary' },
      { action: 'unavailable', title: 'Mark unavailable', variant: 'danger' },
    ],
    availability_confirmed: [
      { action: 'paid', title: 'Mark paid', variant: 'primary' },
      { action: 'unavailable', title: 'Mark unavailable', variant: 'danger' },
    ],
    paid: [{ action: 'voucher', title: 'Send voucher', variant: 'primary' }],
  };

const uploadKey = (id: string) => ['admin', 'hotel-vouchers', 'upload', id];

function AdminHotelBookingView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const uploading = useIsMutating({ mutationKey: uploadKey(id) }) > 0;
  const [dialog, setDialog] = useState<Action | null>(null);
  const queryKey = ['admin', 'hotel-bookings', 'detail', id] as const;
  const booking = useQuery({
    queryKey,
    queryFn: async () => (await api.get<AdminHotelBooking>(`/admin/hotel-bookings/${id}`)).data,
  });
  const updated = (data: AdminHotelBooking) => {
    queryClient.setQueryData(queryKey, data);
    setDialog(null);
    return queryClient.invalidateQueries({ queryKey: ['admin', 'hotel-bookings'] });
  };
  const markPaid = useMutation({
    mutationFn: async () => (await api.post<AdminHotelBooking>(`/admin/hotel-bookings/${id}/mark-paid`)).data,
    onSuccess: updated,
    onError: () => queryClient.invalidateQueries({ queryKey }),
  });

  if (booking.isPending) {
    return <LoadingState />;
  }
  if (booking.isError) {
    return <DetailError error={booking.error} onRetry={() => booking.refetch()} notFound="Booking not found" />;
  }
  const data = booking.data;
  const status = BOOKING_STATUS[data.status];
  const awaiting = data.status === 'availability_confirmed' && data.changes !== null && !data.changes_accepted;
  const run = async (action: Action) => {
    if (action !== 'paid') {
      setDialog(action);
      return;
    }
    if (
      await confirm({
        title: 'Mark paid?',
        message: 'Only do this once the payment has reached you. The customer will be emailed a receipt.',
        confirmLabel: 'Mark paid',
      })
    ) {
      markPaid.mutate();
    }
  };
  const blocked = (action: Action) =>
    (action === 'voucher' && (data.vouchers.length === 0 || uploading)) || (action === 'paid' && awaiting);
  const actions = ACTIONS[data.status] ?? [];

  return (
    <>
      {actions.length ? (
        <ActionBar>
          {actions.map((item) => (
            <Button
              key={item.action}
              title={item.title}
              variant={item.variant}
              onPress={() => run(item.action)}
              disabled={markPaid.isPending || blocked(item.action)}
              loading={item.action === 'paid' && markPaid.isPending}
            />
          ))}
        </ActionBar>
      ) : null}
      <FormError message={markPaid.isError ? errorMessage(markPaid.error) : null} />

      {data.changes ? (
        <Card>
          <Text style={styles.heading}>
            {data.status === 'declined'
              ? 'New total declined by the customer'
              : data.changes_accepted
                ? 'New total accepted by the customer'
                : 'New total waiting for the customer'}
          </Text>
          <View style={styles.row}>
            <Text style={styles.old}>{formatPrice(data.changes.total.old)}</Text>
            <Text style={styles.strong}>→ {formatPrice(data.changes.total.new)}</Text>
          </View>
          {data.changes.note ? <Text style={styles.text}>{data.changes.note}</Text> : null}
          {awaiting ? (
            <Text style={styles.muted}>Mark paid becomes available once the customer accepts the new total.</Text>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <View style={styles.between}>
          <Text style={styles.muted}>
            Requested {formatDateTime(data.created_at)}
            {data.created_by ? ` by ${data.created_by}` : ''}
          </Text>
          {TERMINAL_STATUSES.includes(data.status) ? null : <StatusChip label={status.label} tone={status.tone} />}
        </View>
        <BookingProgress status={data.status} message={data.unavailable_message || undefined} />
        {data.status === 'availability_confirmed' && data.payment_deadline ? (
          <Text style={styles.strong}>Payment due by {formatDateTime(data.payment_deadline)}</Text>
        ) : null}
        {data.hotel_confirmation ? (
          <Text style={styles.text}>Hotel confirmation number: {data.hotel_confirmation}</Text>
        ) : null}
      </Card>

      <Card>
        <Text style={styles.heading}>Booker</Text>
        <Text style={styles.text}>{data.user.full_name}</Text>
        <Text style={styles.text}>{data.user.email}</Text>
        {data.user.phone ? <Text style={styles.text}>{data.user.phone}</Text> : null}
      </Card>

      <Card>
        <Text style={styles.heading}>{data.hotel.name}</Text>
        <Text style={styles.text}>{stayDates(data.check_in, data.check_out)}</Text>
        <Text style={styles.muted}>
          Check-in from {timeLabel(data.hotel.check_in_time)} · Check-out by {timeLabel(data.hotel.check_out_time)}
        </Text>
        <HotelRooms
          booking={data}
          editable={data.can_edit_guests}
          base={`/admin/hotel-bookings/${id}`}
          queryKey={queryKey}
        />
        {data.special_requests ? <Text style={styles.text}>Special requests: {data.special_requests}</Text> : null}
        {data.notes ? <Text style={styles.text}>Notes: {data.notes}</Text> : null}
        <View style={styles.between}>
          <Text style={styles.heading}>Total · {roomsLabel(data.rooms.length)}</Text>
          <PriceTag amount={data.total} size="large" />
        </View>
      </Card>

      {data.status === 'paid' ? <VoucherUploads booking={data} queryKey={queryKey} /> : null}
      {data.status === 'completed' ? (
        <Card>
          <Text style={styles.heading}>Vouchers sent</Text>
          <BoardingPassList passes={data.vouchers} openFile={openHotelVoucher} />
        </Card>
      ) : null}

      <Card>
        <Text style={styles.heading}>Timeline</Text>
        <BookingTimeline events={data.events} labels={HOTEL_EVENT_LABELS} />
      </Card>

      {dialog === 'confirm' ? (
        <ConfirmAvailabilityDialog booking={data} onClose={() => setDialog(null)} onDone={updated} />
      ) : null}
      {dialog === 'unavailable' ? (
        <MarkUnavailableDialog booking={data} onClose={() => setDialog(null)} onDone={updated} />
      ) : null}
      {dialog === 'voucher' ? (
        <SendVoucherDialog booking={data} onClose={() => setDialog(null)} onDone={updated} />
      ) : null}
    </>
  );
}

type DialogProps = {
  booking: AdminHotelBooking;
  onClose: () => void;
  onDone: (booking: AdminHotelBooking) => void;
};

const PRICE = /^\d+(\.\d{1,2})?$/;

function ConfirmAvailabilityDialog({ booking, onClose, onDone }: DialogProps) {
  const [total, setTotal] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>();
  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post<AdminHotelBooking>(`/admin/hotel-bookings/${booking.id}/confirm-availability`, {
          new_total: total.trim() || null,
          note: note.trim(),
        })
      ).data,
    onSuccess: onDone,
  });
  const submit = () => {
    if (total.trim() && (!PRICE.test(total.trim()) || Number(total) <= 0)) {
      setError('Enter an amount greater than 0, e.g. 420.');
      return;
    }
    if (note.trim() && !total.trim()) {
      setError('Enter the new total the note explains.');
      return;
    }
    save.mutate();
  };
  return (
    <Dialog
      open
      title="Confirm availability"
      onClose={onClose}
      busy={save.isPending}
      error={save.isError ? errorMessage(save.error) : null}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={save.isPending} />
          <Button title="Confirm availability" onPress={submit} loading={save.isPending} />
        </>
      }
    >
      <Text style={styles.text}>
        The customer is emailed the payment instructions and deadline. If the hotel quoted another price, enter the new
        total: the customer accepts it before paying.
      </Text>
      <TextField
        label={`New total (optional; now ${formatPrice(booking.total)})`}
        value={total}
        onChangeText={(text) => {
          setTotal(text);
          setError(undefined);
        }}
        error={error}
        keyboardType="decimal-pad"
        placeholder="Leave blank to keep the total"
      />
      <TextField
        label="Note to the customer (optional)"
        placeholder="e.g. The hotel has a festive supplement that week."
        value={note}
        onChangeText={setNote}
        multiline
        numberOfLines={3}
        maxLength={500}
      />
    </Dialog>
  );
}

function MarkUnavailableDialog({ booking, onClose, onDone }: DialogProps) {
  const [message, setMessage] = useState('');
  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post<AdminHotelBooking>(`/admin/hotel-bookings/${booking.id}/mark-unavailable`, {
          message: message.trim(),
        })
      ).data,
    onSuccess: onDone,
  });
  return (
    <Dialog
      open
      title="Mark unavailable"
      onClose={onClose}
      busy={save.isPending}
      error={save.isError ? errorMessage(save.error) : null}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={save.isPending} />
          <Button title="Mark unavailable" variant="danger" onPress={() => save.mutate()} loading={save.isPending} />
        </>
      }
    >
      <Text style={styles.text}>The customer is emailed that the hotel has no rooms. This cannot be undone.</Text>
      <TextField
        label="Message to the customer (optional)"
        placeholder="e.g. The hotel is full that week; Coral Beach has rooms."
        value={message}
        onChangeText={setMessage}
        multiline
        numberOfLines={4}
        maxLength={2000}
      />
    </Dialog>
  );
}

function SendVoucherDialog({ booking, onClose, onDone }: DialogProps) {
  const [number, setNumber] = useState('');
  const [error, setError] = useState<string | undefined>();
  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post<AdminHotelBooking>(`/admin/hotel-bookings/${booking.id}/complete`, {
          hotel_confirmation: number.trim(),
        })
      ).data,
    onSuccess: onDone,
  });
  return (
    <Dialog
      open
      title="Send voucher"
      onClose={onClose}
      busy={save.isPending}
      error={save.isError ? errorMessage(save.error) : null}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={save.isPending} />
          <Button
            title="Send voucher"
            loading={save.isPending}
            onPress={() => (number.trim() ? save.mutate() : setError("Enter the hotel's confirmation number."))}
          />
        </>
      }
    >
      <Text style={styles.text}>
        The customer is emailed {booking.vouchers.length === 1 ? 'the voucher' : `all ${booking.vouchers.length} files`}{' '}
        with the confirmation number. Files cannot be changed afterwards.
      </Text>
      <TextField
        label="Hotel confirmation number"
        value={number}
        onChangeText={(text) => {
          setNumber(text);
          setError(undefined);
        }}
        error={error}
        maxLength={40}
        autoCapitalize="characters"
      />
    </Dialog>
  );
}

const MAX_VOUCHERS = 10;

/** Paid bookings: upload, list and delete vouchers (sent from the action bar). */
function VoucherUploads({ booking, queryKey }: { booking: AdminHotelBooking; queryKey: readonly unknown[] }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [problems, setProblems] = useState<string[]>([]);
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const upload = useMutation({
    mutationKey: uploadKey(booking.id),
    mutationFn: async (files: File[]) => {
      const failed: string[] = [];
      for (const file of files) {
        const body = new FormData();
        body.append('file', file);
        try {
          await api.post(`/admin/hotel-bookings/${booking.id}/vouchers`, body);
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
    mutationFn: async (voucher: HotelVoucher) => api.delete(`/admin/hotel-vouchers/${voucher.id}`),
    onSettled: refresh,
  });
  const onSelect = (files: File[]) => {
    const rejected = files.map(fileProblem).filter((problem): problem is string => problem !== null);
    const accepted = files.filter((file) => fileProblem(file) === null);
    const room = MAX_VOUCHERS - booking.vouchers.length;
    if (accepted.length > room) {
      rejected.push(`A booking can have at most ${MAX_VOUCHERS} vouchers.`);
    }
    setProblems(rejected);
    if (accepted.length && room > 0) {
      upload.mutate(accepted.slice(0, room));
    }
  };
  const onDelete = async (voucher: HotelVoucher) => {
    if (
      await confirm({
        title: 'Delete this file?',
        message: voucher.original_name,
        confirmLabel: 'Delete',
        tone: 'danger',
      })
    ) {
      remove.mutate(voucher);
    }
  };
  return (
    <Card>
      <Text style={styles.heading}>Hotel voucher</Text>
      <FileField
        label="Add files"
        hint={`The hotel's voucher: PDF, PNG or JPEG, up to 5 MB each, at most ${MAX_VOUCHERS} files.`}
        accept={ACCEPT}
        onSelect={onSelect}
        disabled={upload.isPending || booking.vouchers.length >= MAX_VOUCHERS}
      />
      {upload.isPending ? <Text style={styles.muted}>Uploading…</Text> : null}
      {problems.map((problem) => (
        <FormError key={problem} message={problem} />
      ))}
      <FormError message={remove.isError ? errorMessage(remove.error) : null} />
      {booking.vouchers.length ? (
        <BoardingPassList
          passes={booking.vouchers}
          openFile={openHotelVoucher}
          onDelete={onDelete}
          deletingId={remove.isPending ? remove.variables?.id : null}
        />
      ) : (
        <Text style={styles.muted}>
          No files uploaded yet. Send the voucher from the actions above once it is here.
        </Text>
      )}
    </Card>
  );
}

// Hotels

const HOTEL_FILTERS: { value: 'all' | 'active' | 'inactive'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const HOTEL_COLUMNS: Column[] = [
  { label: 'Hotel', flex: 2.5 },
  { label: 'Destination', flex: 2 },
  { label: 'Stars', flex: 1 },
  { label: 'Room types', flex: 1.1 },
  { label: 'From', flex: 1.2 },
  { label: 'Active', flex: 1 },
];

function HotelsTab({ navigation, route }: Props) {
  const isWide = useIsWide();
  const selected = route.params?.id;
  const close = useCallback(() => navigation.setParams({ id: undefined }), [navigation]);
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const hotels = useQuery({
    queryKey: ['admin', 'hotels', filter, page],
    queryFn: async () => {
      const params = { page, ...(filter === 'all' ? {} : { status: filter }) };
      return (await api.get<Paginated<AdminHotel>>('/admin/hotels', { params })).data;
    },
    placeholderData: keepPreviousData,
  });
  const open = (id: string) => navigation.setParams({ id });

  return (
    <DetailLayout
      title="Hotel"
      backLabel="All hotels"
      onClose={close}
      selected={selected}
      rail={{
        title: 'Hotels',
        items: hotels.data?.results.map((hotel) => ({
          id: hotel.id,
          primary: hotel.name,
          secondary: hotel.destination,
          accessibilityLabel: `${hotel.name}, ${hotel.is_active ? 'active' : 'inactive'}`,
        })),
        onSelect: open,
        page,
        count: hotels.data?.count,
        onPage: setPage,
      }}
      detail={
        selected ? (
          <AdminHotelDetailView
            key={selected}
            id={selected}
            onEdit={() => navigation.navigate('AdminHotelEdit', { id: selected })}
            onOpenBooking={(booking) => navigation.setParams({ tab: undefined, id: booking, status: 'all' })}
          />
        ) : null
      }
      list={
        <Screen card>
          <TabSwitch value="hotels" onChange={() => navigation.setParams({ tab: undefined, id: undefined })} />
          <View style={styles.between}>
            <Text style={styles.title}>Hotels</Text>
            <Button title="New hotel" icon="add" onPress={() => navigation.navigate('AdminHotelNew')} />
          </View>
          <SegmentedControl
            label="Show"
            options={HOTEL_FILTERS}
            value={filter}
            onChange={(value) => {
              setFilter(value);
              setPage(1);
            }}
          />
          {hotels.isPending ? (
            <LoadingState />
          ) : hotels.isError ? (
            <ErrorState error={hotels.error} onRetry={() => hotels.refetch()} />
          ) : hotels.data.results.length === 0 ? (
            <EmptyState
              icon="bed-outline"
              title="No hotels"
              message={filter === 'all' ? 'Add your first hotel.' : 'No hotels match this filter.'}
            />
          ) : isWide ? (
            <Table columns={HOTEL_COLUMNS}>
              {hotels.data.results.map((hotel) => (
                <TableRow
                  key={hotel.id}
                  columns={HOTEL_COLUMNS}
                  selected={hotel.id === selected}
                  onPress={() => open(hotel.id)}
                  accessibilityLabel={hotel.name}
                  cells={[
                    <TwoLineCell key="name" primary={hotel.name} secondary={hotel.address} />,
                    hotel.destination,
                    hotel.star_rating ? `${hotel.star_rating} ★` : '—',
                    String(hotel.room_types.length),
                    hotel.from_price ? formatPrice(hotel.from_price) : '—',
                    <StatusChip
                      key="active"
                      label={hotel.is_active ? 'Active' : 'Inactive'}
                      tone={hotel.is_active ? 'success' : 'neutral'}
                    />,
                  ]}
                />
              ))}
            </Table>
          ) : (
            <View style={styles.cards}>
              {hotels.data.results.map((hotel) => (
                <Card key={hotel.id} selected={hotel.id === selected}>
                  <View style={styles.between}>
                    <Text style={[styles.strong, styles.shrink]}>{hotel.name}</Text>
                    <StatusChip
                      label={hotel.is_active ? 'Active' : 'Inactive'}
                      tone={hotel.is_active ? 'success' : 'neutral'}
                    />
                  </View>
                  <Text style={styles.muted}>
                    {hotel.destination} · {starsLabel(hotel.star_rating)} · {hotel.room_types.length} room type
                    {hotel.room_types.length === 1 ? '' : 's'}
                  </Text>
                  <Text style={styles.text}>
                    {hotel.from_price ? `From ${formatPrice(hotel.from_price)} per night` : 'No prices ahead'}
                  </Text>
                  <View style={styles.start}>
                    <Button title="Open" variant="secondary" onPress={() => open(hotel.id)} />
                  </View>
                </Card>
              ))}
            </View>
          )}
          {hotels.data ? <Pagination page={page} count={hotels.data.count} onChange={setPage} /> : null}
        </Screen>
      }
    />
  );
}

function AdminHotelDetailView({
  id,
  onEdit,
  onOpenBooking,
}: {
  id: string;
  onEdit: () => void;
  onOpenBooking: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [bookingsPage, setBookingsPage] = useState(1);
  const hotel = useQuery({
    queryKey: ['admin', 'hotels', 'detail', id],
    queryFn: async () => (await api.get<AdminHotel>(`/admin/hotels/${id}`)).data,
  });
  const bookings = useQuery({
    queryKey: ['admin', 'hotel-bookings', 'hotel', id, bookingsPage],
    queryFn: async () =>
      (
        await api.get<Paginated<AdminHotelBooking>>('/admin/hotel-bookings', {
          params: { hotel: id, page: bookingsPage },
        })
      ).data,
    placeholderData: keepPreviousData,
  });
  const setActive = useMutation({
    mutationFn: async (is_active: boolean) => (await api.patch<AdminHotel>(`/admin/hotels/${id}`, { is_active })).data,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['admin', 'hotels'] }),
  });

  if (hotel.isPending) {
    return <LoadingState />;
  }
  if (hotel.isError) {
    return <DetailError error={hotel.error} onRetry={() => hotel.refetch()} notFound="Hotel not found" />;
  }
  const data = hotel.data;

  return (
    <>
      <Card>
        <View style={styles.between}>
          <Text style={[styles.heading, styles.shrink]}>{data.name}</Text>
          <StatusChip label={data.is_active ? 'Active' : 'Inactive'} tone={data.is_active ? 'success' : 'neutral'} />
        </View>
        <Text style={styles.text}>
          {data.address}, {data.destination} · {starsLabel(data.star_rating)}
        </Text>
        <View style={styles.row}>
          <Button title="Edit" onPress={onEdit} />
          <Button
            title={data.is_active ? 'Deactivate' : 'Activate'}
            variant="secondary"
            loading={setActive.isPending}
            onPress={() => setActive.mutate(!data.is_active)}
          />
        </View>
        <FormError message={setActive.isError ? errorMessage(setActive.error) : null} />
      </Card>

      <Card>
        <Text style={styles.heading}>Details</Text>
        <Fact label="From price" value={data.from_price ? `${formatPrice(data.from_price)} per night` : '—'} />
        <Fact
          label="Check-in and check-out"
          value={`From ${timeLabel(data.check_in_time)} · by ${timeLabel(data.check_out_time)}`}
        />
        <Fact label="Summary" value={data.summary} />
        <RichText html={data.description} />
        <Fact label="Amenities" value={data.amenities.join('\n') || '—'} />
        <Fact label="Cancellation policy" value={data.cancellation_policy} />
      </Card>

      <Card>
        <Text style={styles.heading}>Rooms and rates</Text>
        {data.room_types.length === 0 ? <Text style={styles.muted}>No room types yet.</Text> : null}
        {data.room_types.map((roomType) => (
          <View key={roomType.id} style={styles.roomType}>
            <Text style={styles.strong}>
              {roomType.name}
              {roomType.is_active ? '' : ' (inactive)'}
            </Text>
            <Text style={styles.muted}>
              Holds {guestsLabel(roomType.max_adults, roomType.max_children)}
              {roomType.description ? ` · ${roomType.description}` : ''}
            </Text>
            {roomType.rates.map((rate) => (
              <View key={rate.id} style={styles.rate}>
                <Text style={styles.text}>
                  {rate.name}
                  {rate.is_active ? '' : ' (inactive)'} · sleeps {guestsLabel(rate.max_adults, rate.max_children)}
                  {Number(rate.per_adult_per_night) > 0
                    ? ` · + ${formatPrice(rate.per_adult_per_night)} per adult per night`
                    : ''}
                </Text>
                {rate.inclusions.length ? <Text style={styles.muted}>{rate.inclusions.join(' · ')}</Text> : null}
                {rate.periods.map((period) => (
                  <Text key={period.id} style={styles.muted}>
                    {formatDate(period.start_date)} – {formatDate(period.end_date)}:{' '}
                    {formatPrice(period.price_per_night)} per night
                  </Text>
                ))}
              </View>
            ))}
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
              const state = BOOKING_STATUS[booking.status];
              return (
                <View key={booking.id} style={styles.listRow}>
                  <View style={styles.shrink}>
                    <Text style={styles.strong}>{booking.user.full_name}</Text>
                    <Text style={styles.muted}>
                      {stayDates(booking.check_in, booking.check_out)} · {roomsLabel(booking.rooms.length)} ·{' '}
                      {formatPrice(booking.total)}
                    </Text>
                  </View>
                  <View style={styles.row}>
                    <StatusChip label={state.label} tone={state.tone} />
                    <Button title="Open" variant="link" onPress={() => onOpenBooking(booking.id)} />
                  </View>
                </View>
              );
            })}
            <Pagination page={bookingsPage} count={bookings.data.count} onChange={setBookingsPage} />
          </>
        )}
      </Card>
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

const styles = createStyles(() => ({
  tabs: { maxWidth: 360 },
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
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
  shrink: { flexShrink: 1, minWidth: 0 },
  start: { alignSelf: 'flex-start' },
  cards: { gap: space.md },
  cardWrap: { gap: space.xs },
  picker: { gap: space.sm },
  picked: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fact: { gap: 2 },
  label: { fontSize: font.small, fontWeight: weight.semibold, color: colors.muted },
  value: { fontSize: font.body, color: colors.text },
  roomType: { gap: space.xs, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  rate: { gap: 2, paddingLeft: space.md, borderLeftWidth: 2, borderLeftColor: colors.border, marginTop: space.xs },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    flexWrap: 'wrap',
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  photo: { width: 120, height: 84, borderRadius: radius.md, backgroundColor: colors.neutralTint },
}));
