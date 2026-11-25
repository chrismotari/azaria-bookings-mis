import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { HotelBooking, HotelBookingRoom, Traveller, TravellerInput } from '../../api/types';
import { Button } from '../../components/Button';
import { useConfirm } from '../../components/ConfirmDialog';
import { CoverImage } from '../../components/CoverImage';
import { FormError } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { PriceTag } from '../../components/PriceTag';
import { StatusChip } from '../../components/StatusChip';
import {
  emptyTraveller,
  TravellerDialog,
  TravellerDraft,
  travellerDraft,
  TravellerSummary,
} from '../../components/TravellerForm';
import { TripCard } from '../../components/TripCard';
import { colors, createStyles, font, space, weight } from '../../theme';
import { BOOKING_STATUS } from '../../utils/bookings';
import { formatPrice } from '../../utils/format';
import { guestsLabel, roomsLabel, stayDates } from '../../utils/hotels';

type Editing = { room: HotelBookingRoom; guest: Traveller | null; initial: TravellerDraft };

/**
 * The booking's rooms with their guests; while editable, Add, Edit and Remove (never the lead guest) use the shared
 * traveller form. base: the booking's API path; queryKey: what to refresh after a change.
 */
export function HotelRooms({
  booking,
  editable,
  base,
  queryKey,
}: {
  booking: HotelBooking;
  editable: boolean;
  base: string;
  queryKey: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Editing | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const remove = useMutation({
    mutationFn: (guest: Traveller) => api.delete(`${base}/guests/${guest.id}`),
    onSettled: refresh,
  });
  const save = async (input: TravellerInput) => {
    if (!editing) {
      return;
    }
    if (editing.guest) {
      await api.patch(`${base}/guests/${editing.guest.id}`, input);
    } else {
      await api.post(`${base}/rooms/${editing.room.id}/guests`, input);
    }
    await refresh();
  };
  const onRemove = async (guest: Traveller) => {
    if (
      await confirm({
        title: `Remove ${guest.full_name}?`,
        message: 'Their details are deleted from the booking.',
        confirmLabel: 'Remove',
        tone: 'danger',
      })
    ) {
      remove.mutate(guest);
    }
  };

  return (
    <View style={styles.rooms}>
      {booking.rooms.map((room, index) => (
        <View key={room.id} style={styles.room}>
          <View style={styles.between}>
            <View style={styles.shrink}>
              <Text style={styles.strong}>
                Room {index + 1}: {room.room_name}
              </Text>
              <Text style={styles.muted}>
                {room.rate_name} · {guestsLabel(room.adults, room.children)}
              </Text>
            </View>
            <Text style={styles.strong}>{formatPrice(room.price)}</Text>
          </View>
          {room.guests.map((guest, guestIndex) => (
            <View key={guest.id} style={styles.guest}>
              <Icon name={guestIndex === 0 ? 'person' : 'person-outline'} size={18} color={colors.muted} />
              <View style={styles.guestText}>
                {guestIndex === 0 ? <Text style={styles.lead}>Lead guest</Text> : null}
                <TravellerSummary traveller={guest} />
              </View>
              {editable ? (
                <View style={styles.actions}>
                  <Button
                    title="Edit"
                    variant="link"
                    onPress={() => setEditing({ room, guest, initial: travellerDraft(guest) })}
                  />
                  {guestIndex > 0 ? <Button title="Remove" variant="link" onPress={() => onRemove(guest)} /> : null}
                </View>
              ) : null}
            </View>
          ))}
          {editable && room.guests.length < room.adults + room.children ? (
            <View style={styles.start}>
              <Button
                title="Add guest"
                icon="person-add-outline"
                variant="secondary"
                onPress={() => setEditing({ room, guest: null, initial: emptyTraveller() })}
              />
            </View>
          ) : null}
        </View>
      ))}
      <FormError message={remove.isError ? errorMessage(remove.error) : null} />
      {editing ? (
        <TravellerDialog
          title={editing.guest ? 'Edit guest' : `Add a guest: ${editing.room.room_name}`}
          initial={editing.initial}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}

/** A hotel booking in a list: cover, hotel, dates, rooms and total. */
export function HotelBookingCard({
  booking,
  selected,
  onPress,
}: {
  booking: HotelBooking;
  selected: boolean;
  onPress: () => void;
}) {
  const status = BOOKING_STATUS[booking.status];
  return (
    <TripCard
      tone={status.tone}
      selected={selected}
      onPress={onPress}
      accessibilityLabel={`${booking.hotel.name}, ${stayDates(booking.check_in, booking.check_out)}, ${status.label}`}
    >
      <View style={styles.card}>
        <View style={styles.thumb}>
          <CoverImage url={booking.hotel.cover_url} height={72} />
        </View>
        <View style={styles.cardBody}>
          <View style={styles.between}>
            <Text style={[styles.strong, styles.shrink]} numberOfLines={1}>
              {booking.hotel.name}
            </Text>
            <StatusChip label={status.label} tone={status.tone} />
          </View>
          <Text style={styles.muted}>{stayDates(booking.check_in, booking.check_out)}</Text>
          <View style={styles.between}>
            <Text style={styles.text}>{roomsLabel(booking.rooms.length)}</Text>
            <PriceTag amount={booking.total} />
          </View>
        </View>
      </View>
    </TripCard>
  );
}

const styles = createStyles(() => ({
  rooms: { gap: space.md },
  room: { gap: space.sm, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  shrink: { flexShrink: 1, minWidth: 0 },
  guestText: { flex: 1, minWidth: 160 },
  strong: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  text: { fontSize: font.body, color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
  lead: { fontSize: font.caption, fontWeight: weight.bold, color: colors.tertiary },
  guest: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', gap: space.md, marginLeft: 'auto' },
  start: { alignSelf: 'flex-start' },
  card: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  thumb: { width: 96, borderRadius: 8, overflow: 'hidden' },
  cardBody: { flex: 1, minWidth: 0, gap: space.xs },
}));
