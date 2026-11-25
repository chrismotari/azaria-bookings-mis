import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { Traveller, TourBooking, TourBookingEvent, TourBookingLine, TravellerInput } from '../../api/types';
import { Button } from '../../components/Button';
import { useConfirm } from '../../components/ConfirmDialog';
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
import { formatDateTime, formatPrice } from '../../utils/format';
import { peopleLabel, TOUR_BOOKING_STATUS, TOUR_EVENT_LABELS, tourDates, unitPrice } from '../../utils/tours';
import { TourCover } from './ToursPage';

type Editing = { line: TourBookingLine; traveller: Traveller | null; initial: TravellerDraft };

/**
 * The booking's lines with their travellers; while the booking is confirmed, Add, Edit and Remove use the shared
 * traveller form. base: the booking's API path; queryKey: what to refresh after a change.
 */
export function TourBookingLines({
  booking,
  base,
  queryKey,
}: {
  booking: TourBooking;
  base: string;
  queryKey: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Editing | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const remove = useMutation({
    mutationFn: (traveller: Traveller) => api.delete(`${base}/travellers/${traveller.id}`),
    onSettled: refresh,
  });
  const save = async (input: TravellerInput) => {
    if (!editing) {
      return;
    }
    if (editing.traveller) {
      await api.patch(`${base}/travellers/${editing.traveller.id}`, input);
    } else {
      await api.post(`${base}/travellers`, { ...input, line: editing.line.id });
    }
    await refresh();
  };
  const onRemove = async (traveller: Traveller) => {
    if (
      await confirm({
        title: `Remove ${traveller.full_name}?`,
        message: 'Their details are deleted from the booking.',
        confirmLabel: 'Remove',
        tone: 'danger',
      })
    ) {
      remove.mutate(traveller);
    }
  };
  const editable = booking.can_edit_travellers;

  return (
    <View style={styles.lines}>
      {booking.lines.map((line) => (
        <View key={line.id} style={styles.line}>
          <View style={styles.between}>
            <View style={styles.shrink}>
              <Text style={styles.strong}>
                {line.quantity} × {line.option_name}
              </Text>
              <Text style={styles.muted}>
                {unitPrice({ price: line.unit_price, people_per_unit: line.people_per_unit })} ·{' '}
                {peopleLabel(line.people)}
              </Text>
            </View>
            <Text style={styles.strong}>{formatPrice(line.total_price)}</Text>
          </View>
          <Text style={styles.muted}>
            {line.travellers.length} of {line.people} travellers added
          </Text>
          {line.travellers.map((traveller) => (
            <View key={traveller.id} style={styles.traveller}>
              <Icon name="person-outline" size={18} color={colors.muted} />
              <TravellerSummary traveller={traveller} />
              {editable ? (
                <View style={styles.actions}>
                  <Button
                    title="Edit"
                    variant="link"
                    onPress={() => setEditing({ line, traveller, initial: travellerDraft(traveller) })}
                  />
                  <Button title="Remove" variant="link" onPress={() => onRemove(traveller)} />
                </View>
              ) : null}
            </View>
          ))}
          {editable && line.travellers.length < line.people ? (
            <View style={styles.add}>
              <Button
                title="Add traveller"
                icon="person-add-outline"
                variant="secondary"
                onPress={() => setEditing({ line, traveller: null, initial: emptyTraveller() })}
              />
            </View>
          ) : null}
        </View>
      ))}
      <FormError message={remove.isError ? errorMessage(remove.error) : null} />
      {editing ? (
        <TravellerDialog
          title={editing.traveller ? 'Edit traveller' : `Add a traveller: ${editing.line.option_name}`}
          initial={editing.initial}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}

export function TourBookingTimeline({ events }: { events: TourBookingEvent[] }) {
  return (
    <View style={styles.timeline}>
      {events.map((event) => (
        <View key={event.id} style={styles.event}>
          <View style={styles.dot} />
          <View>
            <Text style={styles.strong}>{TOUR_EVENT_LABELS[event.to_status]}</Text>
            <Text style={styles.muted}>{formatDateTime(event.created_at)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** A tour booking in a list: cover, title, dates, group name, people and total. */
export function TourBookingCard({
  booking,
  selected,
  onPress,
}: {
  booking: TourBooking;
  selected: boolean;
  onPress: () => void;
}) {
  const status = TOUR_BOOKING_STATUS[booking.status];
  return (
    <TripCard
      tone={status.tone}
      selected={selected}
      onPress={onPress}
      accessibilityLabel={`${booking.tour.title}, ${tourDates(booking.tour)}, ${status.label}`}
    >
      <View style={styles.card}>
        <View style={styles.thumb}>
          <TourCover url={booking.tour.cover_url} height={72} />
        </View>
        <View style={styles.cardBody}>
          <View style={styles.between}>
            <Text style={[styles.strong, styles.shrink]} numberOfLines={1}>
              {booking.tour.title}
            </Text>
            <StatusChip label={status.label} tone={status.tone} />
          </View>
          <Text style={styles.muted}>{tourDates(booking.tour)}</Text>
          <View style={styles.between}>
            <Text style={styles.text}>
              {[booking.group_name, peopleLabel(booking.people)].filter(Boolean).join(' · ')}
            </Text>
            <PriceTag amount={booking.total_price} />
          </View>
        </View>
      </View>
    </TripCard>
  );
}

const styles = createStyles(() => ({
  lines: { gap: space.md },
  line: { gap: space.sm, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  shrink: { flexShrink: 1, minWidth: 0 },
  strong: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  text: { fontSize: font.body, color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
  traveller: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', gap: space.md, marginLeft: 'auto' },
  add: { alignSelf: 'flex-start' },
  timeline: { gap: 10 },
  event: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginTop: 5 },
  card: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  thumb: { width: 96, borderRadius: 8, overflow: 'hidden' },
  cardBody: { flex: 1, minWidth: 0, gap: space.xs },
}));
