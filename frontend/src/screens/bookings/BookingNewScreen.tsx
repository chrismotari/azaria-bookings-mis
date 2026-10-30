import { zodResolver } from '@hookform/resolvers/zod';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { api } from '../../api/client';
import { applyServerErrors } from '../../api/errors';
import { BookingDetail, Offer } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FormError } from '../../components/Field';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { TextField } from '../../components/TextField';
import { RootStackParamList } from '../../navigation/types';
import { colors } from '../../theme';
import { formatDate, formatPrice, stopoversLabel, ticketClassLabel } from '../../utils/format';

// Mirrors the server's rules: 1 to 9 passengers.
const schema = z.object({
  passenger_count: z
    .string()
    .trim()
    .regex(/^[1-9]$/, 'Enter a number of passengers from 1 to 9.'),
  notes: z.string().max(2000),
});

type FormValues = z.infer<typeof schema>;

const FIELDS = ['passenger_count', 'notes'] as const;

export function BookingNewScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'BookingNew'>) {
  const { offer: offerId, query } = route.params;
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const offer = useQuery({
    queryKey: ['offers', offerId],
    queryFn: async () => (await api.get<Offer>(`/offers/${offerId}`)).data,
  });
  const { control, handleSubmit, setError, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { passenger_count: '1', notes: '' },
  });
  const passengerCount = useWatch({ control, name: 'passenger_count' });

  if (offer.isPending) {
    return <LoadingState />;
  }
  if (offer.isError) {
    return <ErrorState error={offer.error} onRetry={() => offer.refetch()} />;
  }

  const data = offer.data;
  const count = Number(passengerCount);
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const { data: booking } = await api.post<BookingDetail>('/bookings', {
        offer: offerId,
        passenger_count: Number(values.passenger_count),
        notes: values.notes.trim(),
        query: query ?? null,
      });
      await queryClient.invalidateQueries({ queryKey: ['bookings'] });
      navigation.replace('BookingDetail', { id: booking.id });
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS));
    }
  });

  return (
    <Screen maxWidth={640}>
      <Text style={styles.title}>Book this flight</Text>
      <Card>
        <Text style={styles.route}>
          {data.origin.city} ({data.origin.code}) → {data.destination.city} ({data.destination.code})
        </Text>
        <Text style={styles.text}>
          {formatDate(data.departure_date)} · {data.airline} · {ticketClassLabel(data.ticket_class)} ·{' '}
          {stopoversLabel(data.stopovers)}
        </Text>
        <Text style={styles.text}>{formatPrice(data.price)} per person</Text>
      </Card>
      <Card>
        <Controller
          control={control}
          name="passenger_count"
          render={({ field, fieldState }) => (
            <TextField
              label="Passengers"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              keyboardType="number-pad"
              maxLength={1}
            />
          )}
        />
        <Controller
          control={control}
          name="notes"
          render={({ field, fieldState }) => (
            <TextField
              label="Notes (optional)"
              placeholder="Anything we should know, e.g. seating or meal preferences"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              multiline
              numberOfLines={4}
            />
          )}
        />
        {count >= 1 && count <= 9 ? (
          <Text style={styles.total}>Total: {formatPrice(Number(data.price) * count)}</Text>
        ) : null}
        <Text style={styles.muted}>
          We will check availability and email you payment instructions. Nothing is charged now.
        </Text>
        <FormError message={formError} />
        <View style={styles.actions}>
          <Button title="Request booking" variant="accent" onPress={onSubmit} loading={formState.isSubmitting} />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  route: { fontSize: 18, fontWeight: '700', color: colors.text },
  text: { color: colors.text },
  total: { fontSize: 18, fontWeight: '700', color: colors.primary },
  muted: { color: colors.muted },
  actions: { flexDirection: 'row' },
});
