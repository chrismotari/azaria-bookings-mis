import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { z } from 'zod';

import { api } from '../../api/client';
import { applyServerErrors } from '../../api/errors';
import { ExchangeRate } from '../../api/types';
import { Button } from '../../components/Button';
import { FieldGrid, FormError, inputStyle } from '../../components/Field';
import { FormSection } from '../../components/FormSection';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { TextField } from '../../components/TextField';
import { colors, font, radius, space, weight } from '../../theme';
import { formatDate } from '../../utils/format';

const RATES_KEY = ['platform', 'exchange-rates'];
const FEED_URL = 'https://www.exchangerate-api.com';

// Mirrors the server's rules.
const schema = z.object({
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'Enter a 3-letter ISO currency code.')
    .refine((value) => value.toUpperCase() !== 'USD', 'USD is always 1.'),
  units_per_usd: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,8})?$/, 'Enter a number with up to 8 decimals.')
    .refine((value) => Number(value) > 0, 'Enter a rate greater than 0.'),
});

type FormValues = z.infer<typeof schema>;

/** Platform Settings › Exchange rates: the latest rate per currency, and a manual rate for today. */
export function ExchangeRates() {
  const [filter, setFilter] = useState('');
  const rates = useQuery({
    queryKey: RATES_KEY,
    queryFn: async () => (await api.get<ExchangeRate[]>('/platform/exchange-rates')).data,
  });
  const search = filter.trim().toUpperCase();
  const shown = rates.data?.filter((rate) => rate.currency.includes(search)) ?? [];
  const stale = rates.data?.filter((rate) => rate.stale).length ?? 0;

  return (
    <FormSection
      title="Exchange rates"
      description="Fares from providers are converted to USD with the latest rate on or before the search date, in units of the currency per US dollar. Rates are fetched daily; a manual rate for today is never overwritten by the feed."
    >
      <ManualRateForm />
      {rates.isPending ? (
        <LoadingState />
      ) : rates.isError ? (
        <ErrorState error={rates.error} onRetry={() => rates.refetch()} />
      ) : rates.data.length === 0 ? (
        <EmptyState
          icon="cash-outline"
          title="No rates yet"
          message="The daily feed has not run yet. Enter a manual rate for any currency you need now."
        />
      ) : (
        <>
          {stale ? (
            <Text style={styles.warning}>
              {stale} currenc{stale === 1 ? 'y has' : 'ies have'} a rate more than 3 days old; check that the daily feed is
              running.
            </Text>
          ) : null}
          <TextInput
            style={inputStyle}
            value={filter}
            onChangeText={setFilter}
            placeholder="Find a currency, e.g. KES"
            placeholderTextColor={colors.placeholder}
            accessibilityLabel="Find a currency"
            autoCapitalize="characters"
          />
          {shown.length === 0 ? (
            <Text style={styles.muted}>No currency matches “{filter.trim()}”.</Text>
          ) : (
            <View style={styles.list}>
              {shown.map((rate) => (
                <RateRow key={rate.id} rate={rate} />
              ))}
            </View>
          )}
        </>
      )}
      <Text style={styles.credit}>
        <Text accessibilityRole="link" style={styles.link} onPress={() => Linking.openURL(FEED_URL)}>
          Rates By Exchange Rate API
        </Text>
      </Text>
    </FormSection>
  );
}

function RateRow({ rate }: { rate: ExchangeRate }) {
  return (
    <View style={styles.row}>
      <Text style={styles.code}>{rate.currency}</Text>
      <Text style={styles.rate}>{Number(rate.units_per_usd).toLocaleString('en-US', { maximumFractionDigits: 8 })}</Text>
      <Text style={styles.date}>{formatDate(rate.date)}</Text>
      <View style={styles.chips}>
        <StatusChip label={rate.source === 'manual' ? 'Manual' : 'Feed'} tone={rate.source === 'manual' ? 'info' : 'neutral'} />
        {rate.stale ? <StatusChip label="Stale" tone="warning" /> : null}
      </View>
    </View>
  );
}

function ManualRateForm() {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const { control, handleSubmit, setError, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currency: '', units_per_usd: '' },
  });

  const onSave = handleSubmit(async (values) => {
    setFormError(null);
    setSaved(null);
    try {
      const { data } = await api.post<ExchangeRate>('/platform/exchange-rates', {
        currency: values.currency.trim().toUpperCase(),
        units_per_usd: values.units_per_usd.trim(),
      });
      reset({ currency: '', units_per_usd: '' });
      setSaved(`Saved: 1 USD = ${Number(data.units_per_usd).toLocaleString('en-US', { maximumFractionDigits: 8 })} ${data.currency} today.`);
      await queryClient.invalidateQueries({ queryKey: RATES_KEY });
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['currency', 'units_per_usd']));
    }
  });

  return (
    <View style={styles.form}>
      <Text style={styles.subheading}>Manual rate for today</Text>
      <FieldGrid>
        <Controller
          control={control}
          name="currency"
          render={({ field, fieldState }) => (
            <TextField
              label="Currency"
              placeholder="e.g. KES"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              autoCapitalize="characters"
              maxLength={3}
            />
          )}
        />
        <Controller
          control={control}
          name="units_per_usd"
          render={({ field, fieldState }) => (
            <TextField
              label="Units per US dollar"
              placeholder="e.g. 129.25"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              keyboardType="decimal-pad"
              onSubmitEditing={() => onSave()}
            />
          )}
        />
      </FieldGrid>
      <FormError message={formError} />
      {saved ? <Text style={styles.saved}>{saved}</Text> : null}
      <View style={styles.actions}>
        <Button title="Save rate" variant="secondary" onPress={onSave} loading={formState.isSubmitting} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  subheading: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  actions: { alignItems: 'flex-start' },
  saved: { color: colors.successText, fontWeight: weight.semibold },
  warning: { color: colors.warningText, fontWeight: weight.semibold },
  muted: { color: colors.muted },
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.md,
    rowGap: space.xs,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  code: { width: 44, fontWeight: weight.bold, color: colors.text },
  rate: { minWidth: 110, color: colors.text, fontVariant: ['tabular-nums'] },
  date: { minWidth: 120, fontSize: font.small, color: colors.muted },
  chips: { flexDirection: 'row', gap: space.xs },
  credit: { fontSize: font.caption, color: colors.muted },
  link: { color: colors.primary, textDecorationLine: 'underline' },
});
