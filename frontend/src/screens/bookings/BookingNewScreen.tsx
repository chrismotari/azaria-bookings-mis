import { zodResolver } from '@hookform/resolvers/zod';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { api } from '../../api/client';
import { applyServerErrors } from '../../api/errors';
import { BookingDetail, Offer } from '../../api/types';
import { AirlineBadge } from '../../components/AirlineBadge';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FormError } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { PriceTag } from '../../components/PriceTag';
import { DirectionLine, directionsOf } from '../../components/Itinerary';
import { Screen } from '../../components/Screen';
import { Stepper } from '../../components/Stepper';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { TextField } from '../../components/TextField';
import { MainTabParamList } from '../../navigation/types';
import { colors, font, space, weight } from '../../theme';
import { baggageSummary, formatDate, formatPrice, ticketClassLabel } from '../../utils/format';

// Mirrors the server's rules: 1 to 9 passengers.
const MIN_PASSENGERS = 1;
const MAX_PASSENGERS = 9;

const schema = z.object({
  passenger_count: z.number().int().min(MIN_PASSENGERS).max(MAX_PASSENGERS),
  notes: z.string().max(2000),
});

type FormValues = z.infer<typeof schema>;

const FIELDS = ['passenger_count', 'notes'] as const;

export function BookingNewScreen({ navigation, route }: BottomTabScreenProps<MainTabParamList, 'BookingNew'>) {
  const { offer: offerId, query } = route.params;
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const offer = useQuery({
    queryKey: ['offers', offerId],
    queryFn: async () => (await api.get<Offer>(`/offers/${offerId}`)).data,
  });
  const { control, handleSubmit, setError, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { passenger_count: 1, notes: '' },
  });
  const passengerCount = useWatch({ control, name: 'passenger_count' });

  if (offer.isPending) {
    return <LoadingState />;
  }
  if (offer.isError) {
    return <ErrorState error={offer.error} onRetry={() => offer.refetch()} />;
  }

  const data = offer.data;
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const { data: booking } = await api.post<BookingDetail>('/bookings', {
        offer: offerId,
        passenger_count: values.passenger_count,
        notes: values.notes.trim(),
        query: query ?? null,
      });
      await queryClient.invalidateQueries({ queryKey: ['bookings'] });
      navigation.navigate('Bookings', { id: booking.id });
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS));
    }
  });

  return (
    <Screen maxWidth={640}>
      <BackLink label="Offer" onPress={() => navigation.navigate('Explore', { id: offerId, ...(query ? { query } : {}) })} />
      <Text style={styles.title}>Book this flight</Text>
      <Card>
        {directionsOf(data.itinerary).map(({ key, label, direction }) => (
          <View key={key} style={styles.direction}>
            <View style={styles.summaryItem}>
              <Icon name="calendar-outline" size={18} color={colors.primary} />
              <Text style={styles.text}>
                <Text style={styles.airline}>{label}</Text> · {formatDate(direction.segments[0].departure_date)}
              </Text>
            </View>
            <DirectionLine direction={direction} />
          </View>
        ))}
        <View style={styles.summary}>
          <View style={styles.summaryItem}>
            <Icon name="briefcase-outline" size={18} color={colors.primary} />
            <Text style={styles.text}>{baggageSummary(data)}</Text>
          </View>
          <View style={styles.summaryItem}>
            <AirlineBadge airline={data.airline} />
            <View>
              <Text style={styles.airline}>{data.airline.name}</Text>
              <Text style={styles.muted}>{ticketClassLabel(data.ticket_class)}</Text>
            </View>
          </View>
        </View>
      </Card>
      <Card>
        <Controller
          control={control}
          name="passenger_count"
          render={({ field, fieldState }) => (
            <Stepper
              label="Passengers"
              value={field.value}
              min={MIN_PASSENGERS}
              max={MAX_PASSENGERS}
              onChange={field.onChange}
              decreaseLabel="Remove a passenger"
              increaseLabel="Add a passenger"
              error={fieldState.error?.message}
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
        <View style={styles.total}>
          <View>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.muted}>
              {passengerCount} × {formatPrice(data.price)}
            </Text>
          </View>
          <PriceTag amount={Number(data.price) * passengerCount} size="large" />
        </View>
        <Text style={styles.muted}>
          We will check availability and email you payment instructions. Nothing is charged now.
        </Text>
        <FormError message={formError} />
        <Button title="Request booking" variant="accent" onPress={onSubmit} loading={formState.isSubmitting} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  summary: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space.md },
  summaryItem: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  direction: { gap: space.sm },
  airline: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  text: { fontSize: font.body, color: colors.text },
  total: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalLabel: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
});
