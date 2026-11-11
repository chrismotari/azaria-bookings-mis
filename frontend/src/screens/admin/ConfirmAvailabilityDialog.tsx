import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm, useFormState, useWatch } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { api } from '../../api/client';
import { applyServerErrors } from '../../api/errors';
import { AdminBookingDetail, BookingChanges, Direction, SegmentChange } from '../../api/types';
import { Button } from '../../components/Button';
import { ChangeList } from '../../components/ChangeList';
import { Dialog } from '../../components/Dialog';
import { FormSection } from '../../components/FormSection';
import { TextField } from '../../components/TextField';
import { colors, font, space } from '../../theme';
import { formatDate } from '../../utils/format';
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
function pendingChanges(booking: AdminBookingDetail, values: Values): BookingChanges | null {
  const changes: BookingChanges = {};
  const price = Number(values.unit_price.trim());
  if (values.unit_price.trim() && price > 0 && price !== Number(booking.unit_price)) {
    changes.unit_price = { old: booking.unit_price, new: price.toFixed(2) };
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
  const { control, handleSubmit, setError, formState } = useForm<Values>({
    resolver: zodResolver(schema(booking)),
    defaultValues: { unit_price: booking.unit_price, segments: toItineraryFormValues(booking.itinerary) },
  });
  const values = useWatch({ control }) as Values;
  const changes = pendingChanges(booking, values);
  const { errors } = useFormState({ control, name: 'segments' });

  const onSubmit = handleSubmit(async (submitted) => {
    setFormError(null);
    try {
      const response = await api.post<AdminBookingDetail>(`/admin/bookings/${booking.id}/confirm-availability`, {
        unit_price: submitted.unit_price.trim(),
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

const styles = StyleSheet.create({
  summary: { gap: space.sm },
  text: { color: colors.text, fontSize: font.body },
  muted: { color: colors.muted },
  error: { color: colors.dangerText, fontSize: font.small },
});
