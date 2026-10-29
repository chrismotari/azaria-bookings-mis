import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { api } from '../../api/client';
import { applyServerErrors } from '../../api/errors';
import { Airport, Query, TICKET_CLASSES, TicketClass } from '../../api/types';
import { AirportPicker } from '../../components/AirportPicker';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DateField } from '../../components/DateField';
import { FieldGrid, FormError } from '../../components/Field';
import { OptionChips } from '../../components/OptionChips';
import { Screen } from '../../components/Screen';
import { LoadingState } from '../../components/StatusViews';
import { TextField } from '../../components/TextField';
import { QueryPrefill, RootStackParamList } from '../../navigation/types';
import { colors } from '../../theme';
import { todayInNairobi } from '../../utils/format';

type FormValues = {
  origin: Airport | null;
  destination: Airport | null;
  date_from: string;
  date_to: string;
  price_min: string;
  price_max: string;
  ticket_class: '' | TicketClass;
  max_stopovers: string;
  message: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^(\d{1,8}(\.\d{1,2})?)?$/;

// Mirrors the server's rules for a request.
const schema = z
  .object({
    origin: z.custom<Airport | null>(),
    destination: z.custom<Airport | null>(),
    date_from: z.string().regex(DATE, 'Enter the earliest departure date.'),
    date_to: z.string().refine((value) => value === '' || DATE.test(value), 'Enter a valid date.'),
    price_min: z.string().trim().regex(AMOUNT, 'Enter an amount, e.g. 500.'),
    price_max: z.string().trim().regex(AMOUNT, 'Enter an amount, e.g. 900.'),
    ticket_class: z.enum(['', 'economy', 'premium_economy', 'business', 'first']),
    max_stopovers: z
      .string()
      .trim()
      .regex(/^(\d{1,2})?$/, 'Enter a whole number.'),
    message: z.string().max(2000),
  })
  .superRefine((values, ctx) => {
    if (!values.origin && !values.destination) {
      ctx.addIssue({ code: 'custom', path: ['destination'], message: 'Choose where from, where to, or both.' });
    }
    if (values.date_to && values.date_to < values.date_from) {
      ctx.addIssue({ code: 'custom', path: ['date_to'], message: 'Must be on or after the earliest date.' });
    }
    if (values.price_min && values.price_max && Number(values.price_min) > Number(values.price_max)) {
      ctx.addIssue({ code: 'custom', path: ['price_max'], message: 'Must be at least the minimum price.' });
    }
  });

const FIELDS = [
  'origin',
  'destination',
  'date_from',
  'date_to',
  'price_min',
  'price_max',
  'ticket_class',
  'max_stopovers',
  'message',
] as const;

const AMOUNT_LABELS = { price_min: 'Min price (USD)', price_max: 'Max price (USD)', max_stopovers: 'Max stopovers' };

const CLASS_OPTIONS: { value: '' | TicketClass; label: string }[] = [{ value: '', label: 'Any' }, ...TICKET_CLASSES];

/** The airport with exactly this IATA code, or null. */
function useAirportByCode(code: string | undefined) {
  return useQuery({
    queryKey: ['airports', 'code', code],
    queryFn: async () => {
      const { data } = await api.get<Airport[]>('/airports', { params: { search: code } });
      return data.find((airport) => airport.code === code?.toUpperCase()) ?? null;
    },
    enabled: Boolean(code),
    staleTime: Infinity,
  });
}

export function QueryNewScreen({ route }: NativeStackScreenProps<RootStackParamList, 'QueryNew'>) {
  const prefill = route.params ?? {};
  const origin = useAirportByCode(prefill.origin);
  const destination = useAirportByCode(prefill.destination);
  if ((prefill.origin && origin.isPending) || (prefill.destination && destination.isPending)) {
    return <LoadingState />;
  }
  return <QueryForm prefill={prefill} origin={origin.data ?? null} destination={destination.data ?? null} />;
}

type FormProps = { prefill: QueryPrefill; origin: Airport | null; destination: Airport | null };

function QueryForm({ prefill, origin, destination }: FormProps) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const isClass = TICKET_CLASSES.some((option) => option.value === prefill.ticket_class);
  const { control, handleSubmit, setError, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      origin,
      destination,
      date_from: prefill.date_from || todayInNairobi(),
      date_to: prefill.date_to ?? '',
      price_min: prefill.price_min ?? '',
      price_max: prefill.price_max ?? '',
      ticket_class: isClass ? (prefill.ticket_class as TicketClass) : '',
      max_stopovers: prefill.max_stopovers ?? '',
      message: '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const optional = (value: string) => (value.trim() === '' ? null : value.trim());
    try {
      const { data } = await api.post<Query>('/queries', {
        origin: values.origin?.id ?? null,
        destination: values.destination?.id ?? null,
        date_from: values.date_from,
        date_to: optional(values.date_to),
        price_min: optional(values.price_min),
        price_max: optional(values.price_max),
        ticket_class: values.ticket_class,
        max_stopovers: optional(values.max_stopovers),
        message: values.message.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: ['queries'] });
      navigation.replace('QueryDetail', { id: data.id });
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS));
    }
  });

  return (
    <Screen maxWidth={760}>
      <Text style={styles.title}>Request flight options</Text>
      <Text style={styles.help}>Tell us what you are looking for and we will send you options by email and here.</Text>
      <Card>
        <FieldGrid>
          {(['origin', 'destination'] as const).map((name) => (
            <Controller
              key={name}
              control={control}
              name={name}
              render={({ field, fieldState }) => (
                <AirportPicker
                  label={name === 'origin' ? 'From (optional)' : 'To (optional)'}
                  value={field.value}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                />
              )}
            />
          ))}
        </FieldGrid>
        <FieldGrid>
          {(['date_from', 'date_to'] as const).map((name) => (
            <Controller
              key={name}
              control={control}
              name={name}
              render={({ field, fieldState }) => (
                <DateField
                  label={name === 'date_from' ? 'Earliest departure' : 'Latest departure (optional)'}
                  value={field.value}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                />
              )}
            />
          ))}
        </FieldGrid>
        <FieldGrid>
          {(['price_min', 'price_max', 'max_stopovers'] as const).map((name) => (
            <Controller
              key={name}
              control={control}
              name={name}
              render={({ field, fieldState }) => (
                <TextField
                  label={AMOUNT_LABELS[name]}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                  keyboardType={name === 'max_stopovers' ? 'number-pad' : 'decimal-pad'}
                />
              )}
            />
          ))}
        </FieldGrid>
        <Controller
          control={control}
          name="ticket_class"
          render={({ field }) => (
            <OptionChips label="Class" options={CLASS_OPTIONS} value={field.value} onChange={field.onChange} />
          )}
        />
        <Controller
          control={control}
          name="message"
          render={({ field, fieldState }) => (
            <TextField
              label="Message (optional)"
              placeholder="Anything else we should know, e.g. number of travellers"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              multiline
              numberOfLines={4}
            />
          )}
        />
        <FormError message={formError} />
        <View style={styles.actions}>
          <Button title="Send request" onPress={onSubmit} loading={formState.isSubmitting} />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  help: { color: colors.muted },
  actions: { flexDirection: 'row', gap: 8 },
});
