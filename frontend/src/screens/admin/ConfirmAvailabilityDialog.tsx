import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm, useFormState, useWatch } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { api } from '../../api/client';
import { applyServerErrors, errorMessage } from '../../api/errors';
import {
  AdminBookingDetail,
  Airline,
  BookingChanges,
  CheckedFare,
  Direction,
  FareRecheck,
  SegmentChange,
} from '../../api/types';
import { AirlineBadge } from '../../components/AirlineBadge';
import { Button } from '../../components/Button';
import { ChangeList } from '../../components/ChangeList';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/Field';
import { FormSection } from '../../components/FormSection';
import { DirectionLine, directionsOf } from '../../components/Itinerary';
import { StatusChip } from '../../components/StatusChip';
import { TextField } from '../../components/TextField';
import { colors, font, radius, space, weight } from '../../theme';
import { flightNumber, formatDate, formatMoney, formatPrice } from '../../utils/format';
import {
  ItineraryFormValues,
  SegmentFormValues,
  checkItinerary,
  itinerarySchema,
  toItineraryFormValues,
  toSegmentsBody,
} from './offerSchema';
import { SegmentFields } from './SegmentFields';

type Values = { unit_price: string; segments: ItineraryFormValues };

const FIELDS = ['unit_price', 'segments'] as const;

/** The booking keeps its trip type and route; its flights, dates and times may change. */
function schema(booking: AdminBookingDetail) {
  return z
    .object({
      unit_price: z
        .string()
        .trim()
        .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter a price in USD, e.g. 650 or 650.50.')
        .refine((value) => Number(value) > 0, 'Price must be greater than 0.'),
      segments: itinerarySchema,
    })
    .superRefine((values, ctx) =>
      checkItinerary(ctx, booking.trip_type, values.segments, {
        origin: booking.offer.origin,
        destination: booking.offer.destination,
      }),
    );
}

/** A flight as the server records it in the booking's changes. */
function toChange(direction: Direction, segment: SegmentFormValues): SegmentChange {
  const day = (date: string) => (Number.isNaN(Date.parse(date)) ? date : formatDate(date));
  return {
    direction,
    flight: `${segment.airline?.iata_code ?? ''} ${segment.flight_number.trim().toUpperCase()}`,
    route: `${segment.origin?.code ?? ''} → ${segment.destination?.code ?? ''}`,
    departure: `${day(segment.departure_date)} ${segment.departure_time}`,
    arrival:
      segment.arrival_date === segment.departure_date
        ? segment.arrival_time
        : `${day(segment.arrival_date)} ${segment.arrival_time}`,
  };
}

function toChanges(booking: AdminBookingDetail, segments: ItineraryFormValues): SegmentChange[] {
  const directions: Direction[] = booking.trip_type === 'return' ? ['outbound', 'return'] : ['outbound'];
  return directions.flatMap((direction) => segments[direction].map((segment) => toChange(direction, segment)));
}

/** What confirming with these values would change, in the server's format; null when nothing would. */
function pendingChanges(booking: AdminBookingDetail, values: Values, airline: Airline): BookingChanges | null {
  const changes: BookingChanges = {};
  const price = Number(values.unit_price.trim());
  if (values.unit_price.trim() && price > 0 && price !== Number(booking.unit_price)) {
    changes.unit_price = { old: booking.unit_price, new: price.toFixed(2) };
  }
  if (airline.id !== booking.airline.id) {
    changes.airline = { old: booking.airline.name, new: airline.name };
  }
  const before = toChanges(booking, toItineraryFormValues(booking.itinerary));
  const after = toChanges(booking, values.segments);
  const operated = (segments: ItineraryFormValues) =>
    [...segments.outbound, ...(booking.trip_type === 'return' ? segments.return : [])].map(
      (segment) => segment.operating_airline?.id ?? '',
    );
  if (
    JSON.stringify(before) !== JSON.stringify(after) ||
    JSON.stringify(operated(toItineraryFormValues(booking.itinerary))) !== JSON.stringify(operated(values.segments))
  ) {
    changes.segments = { old: before, new: after };
  }
  return Object.keys(changes).length ? changes : null;
}

type Props = {
  booking: AdminBookingDetail;
  open: boolean;
  onClose: () => void;
  onDone: (booking: AdminBookingDetail) => void;
};

/** Confirm availability, optionally with a new price per person and flights for the customer to accept. */
export function ConfirmAvailabilityDialog({ booking, open, onClose, onDone }: Props) {
  // A fresh form each time the dialog opens.
  return open ? <ConfirmForm booking={booking} onClose={onClose} onDone={onDone} /> : null;
}

function ConfirmForm({ booking, onClose, onDone }: Omit<Props, 'open'>) {
  const [formError, setFormError] = useState<string | null>(null);
  // The ticketing airline is not edited here: it follows the fare a re-check fills in.
  const [airline, setAirline] = useState<Airline>(booking.airline);
  const { control, handleSubmit, setError, setValue, formState } = useForm<Values>({
    resolver: zodResolver(schema(booking)),
    defaultValues: { unit_price: booking.unit_price, segments: toItineraryFormValues(booking.itinerary) },
  });
  const values = useWatch({ control }) as Values;
  const changes = pendingChanges(booking, values, airline);
  const { errors } = useFormState({ control, name: 'segments' });

  // Fills the price (when the fare has a USD price), ticketing airline and flights from a re-checked fare.
  const applyFare = (fare: CheckedFare) => {
    const options = { shouldDirty: true, shouldValidate: true };
    setAirline(fare.airline);
    if (fare.selling_price) {
      setValue('unit_price', fare.selling_price, options);
    }
    const segments = toItineraryFormValues(fare.itinerary);
    setValue('segments.outbound', segments.outbound, options);
    setValue('segments.return', segments.return, options);
  };

  const onSubmit = handleSubmit(async (submitted) => {
    setFormError(null);
    try {
      const response = await api.post<AdminBookingDetail>(`/admin/bookings/${booking.id}/confirm-availability`, {
        unit_price: submitted.unit_price.trim(),
        airline: airline.id,
        segments: toSegmentsBody(booking.trip_type, submitted.segments),
      });
      onDone(response.data);
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS));
    }
  });

  return (
    <Dialog
      open
      title="Confirm availability"
      size="large"
      onClose={onClose}
      busy={formState.isSubmitting}
      error={formError}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={formState.isSubmitting} />
          <Button title="Confirm availability" onPress={onSubmit} loading={formState.isSubmitting} />
        </>
      }
    >
      <Text style={styles.text}>
        Check the price and flights with the airline. If anything differs, change it here: the customer is asked to
        accept the changes before paying.
      </Text>
      {booking.source === 'gds' && booking.status === 'requested' ? (
        <FareRecheckPanel booking={booking} onApply={applyFare} />
      ) : null}
      <FormSection title="Price" plain>
        <Controller
          control={control}
          name="unit_price"
          render={({ field, fieldState }) => (
            <TextField
              label="Price per person (USD)"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              keyboardType="decimal-pad"
            />
          )}
        />
      </FormSection>
      <View style={styles.carrier}>
        <Text style={styles.muted}>Ticketing airline</Text>
        <AirlineBadge airline={airline} size={28} />
        <Text style={[styles.strong, styles.shrink]} numberOfLines={1}>
          {airline.name}
        </Text>
      </View>
      <FormSection title="Outbound flights" description="Local times of each airport." plain>
        <SegmentFields control={control} direction="outbound" />
      </FormSection>
      {booking.trip_type === 'return' ? (
        <FormSection title="Return flights" plain>
          <SegmentFields control={control} direction="return" />
        </FormSection>
      ) : null}
      {errors.segments?.message ? <Text style={styles.error}>{errors.segments.message}</Text> : null}
      <FormSection title="What will change" plain>
        {changes ? (
          <View style={styles.summary}>
            <ChangeList changes={changes} />
            <Text style={styles.muted}>
              The customer is emailed the payment instructions and asked to accept these changes before paying.
            </Text>
          </View>
        ) : (
          <Text style={styles.muted}>
            Nothing: the booking is confirmed as requested and the customer is emailed the payment instructions.
          </Text>
        )}
      </FormSection>
    </Dialog>
  );
}

/** Searches the booking's flights again through its integration and fills the dialog from the answer. */
function FareRecheckPanel({ booking, onApply }: { booking: AdminBookingDetail; onApply: (fare: CheckedFare) => void }) {
  const [applied, setApplied] = useState<string | null>(null);
  const recheck = useMutation({
    mutationFn: async () => (await api.post<FareRecheck>(`/admin/bookings/${booking.id}/recheck-fare`)).data,
    onSuccess: (answer) => {
      setApplied(answer.fare?.fare_key ?? null);
      if (answer.fare) {
        onApply(answer.fare);
      }
    },
  });
  const use = (fare: CheckedFare) => {
    setApplied(fare.fare_key);
    onApply(fare);
  };
  const answer = recheck.data;

  return (
    <FormSection title="Fare" plain>
      <View style={styles.recheckBar}>
        <Text style={[styles.muted, styles.shrink]}>
          Search {booking.integration?.name ?? 'the fare provider'} again for these flights. Uses one search from this
          month's allowance.
        </Text>
        <Button
          title={answer ? 'Re-check again' : 'Re-check price'}
          variant="secondary"
          icon="refresh"
          onPress={() => recheck.mutate()}
          loading={recheck.isPending}
        />
      </View>
      <FormError message={recheck.isError ? errorMessage(recheck.error) : null} />
      {answer?.fare ? (
        <View style={styles.result}>
          <View style={styles.resultHeader}>
            <Text style={styles.strong}>Still available</Text>
            <StatusChip label="Filled in below" tone="success" />
          </View>
          <FareAmounts fare={answer.fare} />
          {answer.fare.no_rate ? (
            <Text style={styles.warning}>
              No rate for {answer.fare.net_currency} yet: the flights were filled in, the price was left as it is.
            </Text>
          ) : null}
        </View>
      ) : null}
      {answer && !answer.fare ? (
        <View style={styles.result}>
          <Text style={styles.strong}>
            These flights were not found on {formatDate(booking.itinerary.outbound.segments[0].departure_date)}.
          </Text>
          {answer.alternatives.length ? (
            <>
              <Text style={styles.muted}>The cheapest other flights on the same dates:</Text>
              {answer.alternatives.map((fare) => (
                <Alternative
                  key={fare.fare_key}
                  fare={fare}
                  inUse={applied === fare.fare_key}
                  onUse={() => use(fare)}
                />
              ))}
            </>
          ) : (
            <Text style={styles.muted}>No other flights with a price in USD were found on these dates.</Text>
          )}
        </View>
      ) : null}
    </FormSection>
  );
}

function FareAmounts({ fare }: { fare: CheckedFare }) {
  return (
    <View style={styles.amounts}>
      <Line label="Provider price" value={formatMoney(fare.net_amount, fare.net_currency)} />
      {fare.net_usd ? (
        <>
          <Line label="In USD" value={formatPrice(fare.net_usd)} />
          {fare.net_currency !== 'USD' && fare.rate_date ? (
            <Text style={styles.small}>
              At {Number(fare.rate).toLocaleString('en-US', { maximumFractionDigits: 8 })} {fare.net_currency} per USD,
              rate of {formatDate(fare.rate_date)}
            </Text>
          ) : null}
          <Line label="Selling price with markup" value={formatPrice(fare.selling_price ?? 0)} />
        </>
      ) : null}
    </View>
  );
}

function Alternative({ fare, inUse, onUse }: { fare: CheckedFare; inUse: boolean; onUse: () => void }) {
  const directions = directionsOf(fare.itinerary);
  return (
    <View style={[styles.alternative, inUse && styles.alternativeInUse]}>
      <View style={styles.resultHeader}>
        <View style={styles.carrier}>
          <AirlineBadge airline={fare.airline} size={28} />
          <View style={styles.shrink}>
            <Text style={styles.strong} numberOfLines={1}>
              {fare.airline.name}
            </Text>
            <Text style={styles.small}>
              {directions.flatMap(({ direction }) => direction.segments.map(flightNumber)).join(' · ')}
            </Text>
          </View>
        </View>
        {inUse ? (
          <StatusChip label="Filled in below" tone="success" />
        ) : (
          <Button title="Use these flights" variant="secondary" onPress={onUse} />
        )}
      </View>
      {directions.map(({ key, label, direction }) => (
        <View key={key} style={styles.lineRow}>
          {directions.length > 1 ? <Text style={styles.lineLabel}>{label}</Text> : null}
          <View style={styles.shrink}>
            <DirectionLine direction={direction} />
          </View>
        </View>
      ))}
      <FareAmounts fare={fare} />
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={styles.strong}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  recheckBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  shrink: { flex: 1, flexShrink: 1, minWidth: 0 },
  result: { gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.background },
  resultHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  amounts: { gap: space.xs },
  line: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space.sm },
  alternative: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  alternativeInUse: { borderColor: colors.successText },
  carrier: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1, minWidth: 0 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  lineLabel: { width: 60, fontSize: font.caption, fontWeight: weight.bold, color: colors.muted },
  strong: { fontWeight: weight.bold, color: colors.text },
  small: { fontSize: font.small, color: colors.muted },
  warning: { fontSize: font.small, color: colors.warningText, fontWeight: weight.semibold },
  summary: { gap: space.sm },
  text: { color: colors.text, fontSize: font.body },
  muted: { color: colors.muted },
  error: { color: colors.dangerText, fontSize: font.small },
});
