import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { api } from '../../api/client';
import { applyServerErrors } from '../../api/errors';
import { AdminBookingDetail, BookingChanges, StopChange } from '../../api/types';
import { Button } from '../../components/Button';
import { ChangeList } from '../../components/ChangeList';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/Field';
import { FormSection } from '../../components/FormSection';
import { TextField } from '../../components/TextField';
import { colors, font, space } from '../../theme';
import {
  StopFormValues,
  checkStopAirports,
  stopMinutes,
  stopsSchema,
  toStopFormValues,
  toStopsBody,
} from './offerSchema';
import { StopFields } from './StopFields';

type Values = { unit_price: string; stops: StopFormValues[] };

const FIELDS = ['unit_price', 'stops'] as const;

function schema(booking: AdminBookingDetail) {
  return z
    .object({
      unit_price: z
        .string()
        .trim()
        .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter a price in USD, e.g. 650 or 650.50.')
        .refine((value) => Number(value) > 0, 'Price must be greater than 0.'),
      stops: stopsSchema,
    })
    .superRefine((values, ctx) => checkStopAirports(ctx, booking.offer.origin, booking.offer.destination, values.stops));
}

function toStopChanges(stops: StopFormValues[]): StopChange[] {
  return stops
    .filter((stop) => stop.airport && stopMinutes(stop) > 0)
    .map((stop) => ({ code: stop.airport!.code, city: stop.airport!.city, duration_minutes: stopMinutes(stop) }));
}

/** What confirming with these values would change, in the server's format; null when nothing would. */
function pendingChanges(booking: AdminBookingDetail, values: Values): BookingChanges | null {
  const changes: BookingChanges = {};
  const price = Number(values.unit_price.trim());
  if (values.unit_price.trim() && price > 0 && price !== Number(booking.unit_price)) {
    changes.unit_price = { old: booking.unit_price, new: price.toFixed(2) };
  }
  const oldStops = booking.stops.map((stop) => ({
    code: stop.airport.code,
    city: stop.airport.city,
    duration_minutes: stop.duration_minutes,
  }));
  const newStops = toStopChanges(values.stops);
  const key = (stops: StopChange[]) => stops.map((stop) => `${stop.code}:${stop.duration_minutes}`).join(',');
  if (key(oldStops) !== key(newStops) || newStops.length !== values.stops.length) {
    changes.stops = { old: oldStops, new: newStops };
  }
  return Object.keys(changes).length ? changes : null;
}

type Props = {
  booking: AdminBookingDetail;
  open: boolean;
  onClose: () => void;
  onDone: (booking: AdminBookingDetail) => void;
};

/** Confirm availability, optionally with a new price per person and stop list for the customer to accept. */
export function ConfirmAvailabilityDialog({ booking, open, onClose, onDone }: Props) {
  // A fresh form each time the dialog opens.
  return open ? <ConfirmForm booking={booking} onClose={onClose} onDone={onDone} /> : null;
}

function ConfirmForm({ booking, onClose, onDone }: Omit<Props, 'open'>) {
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, formState } = useForm<Values>({
    resolver: zodResolver(schema(booking)),
    defaultValues: { unit_price: booking.unit_price, stops: toStopFormValues(booking.stops) },
  });
  const values = useWatch({ control }) as Values;
  const changes = pendingChanges(booking, values);

  const onSubmit = handleSubmit(async (submitted) => {
    setFormError(null);
    try {
      const response = await api.post<AdminBookingDetail>(`/admin/bookings/${booking.id}/confirm-availability`, {
        unit_price: submitted.unit_price.trim(),
        stops: toStopsBody(submitted.stops),
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
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={formState.isSubmitting} />
          <Button title="Confirm availability" onPress={onSubmit} loading={formState.isSubmitting} />
        </>
      }
    >
      <Text style={styles.text}>
        Check the price and stops with the airline. If anything differs, change it here: the customer is asked to accept
        the changes before paying.
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
      <FormSection title="Stops" description="Under 24 hours is a layover; 24 hours or more is a stopover." plain>
        <StopFields control={control} />
      </FormSection>
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
      <FormError message={formError} />
    </Dialog>
  );
}

const styles = StyleSheet.create({
  summary: { gap: space.sm },
  text: { color: colors.text, fontSize: font.body },
  muted: { color: colors.muted },
});
