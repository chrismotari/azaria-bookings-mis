import { zodResolver } from '@hookform/resolvers/zod';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { AdminOffering, AdminQueryDetail, Paginated } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Field, FormError, inputStyle } from '../../components/Field';
import {
  OfferingFilterErrors,
  OfferingFilterFields,
  OfferingFilterValues,
  offeringFilterParams,
  validateOfferingFilters,
} from '../../components/OfferingFilterFields';
import { Pagination } from '../../components/Pagination';
import { QuerySummary } from '../../components/QuerySummary';
import { Screen } from '../../components/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { RootStackParamList } from '../../navigation/types';
import { colors } from '../../theme';
import { formatDate, formatPrice, stopoversLabel, ticketClassLabel, todayInNairobi } from '../../utils/format';
import { useAdminQuery } from './AdminQueryDetailScreen';
import { OfferingFields } from './OfferingFields';
import { OfferingFormValues, offeringSchema, toOfferingBody } from './offeringSchema';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminQueryRespond'>;

export function AdminQueryRespondScreen({ navigation, route }: Props) {
  const query = useAdminQuery(route.params.id);
  if (query.isPending) {
    return <LoadingState />;
  }
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  }
  return (
    <RespondForm query={query.data} onSent={() => navigation.replace('AdminQueryDetail', { id: query.data.id })} />
  );
}

/** Existing-offering search starts from the customer's own criteria. */
function initialFilters(query: AdminQueryDetail): OfferingFilterValues {
  const airport = (value: AdminQueryDetail['origin']) => ({ text: value?.code ?? '', airport: value });
  return {
    origin: airport(query.origin),
    destination: airport(query.destination),
    date_from: query.date_from,
    date_to: query.date_to ?? '',
    price_min: '',
    price_max: '',
    ticket_class: query.ticket_class,
    max_stopovers: query.max_stopovers === null ? '' : String(query.max_stopovers),
  };
}

function customOfferingDefaults(query: AdminQueryDetail): OfferingFormValues {
  return {
    origin: query.origin,
    destination: query.destination,
    departure_date: query.date_from,
    ticket_class: query.ticket_class || 'economy',
    price: '',
    stopovers: '0',
    airline: '',
    valid_until: todayInNairobi(),
    is_public: false,
  };
}

/** First message of each field error the server returned for one new offering. */
function itemErrors(errors: unknown): string | null {
  if (!errors || typeof errors !== 'object') {
    return null;
  }
  const messages = Object.entries(errors as Record<string, unknown>).map(
    ([field, value]) => `${field.replace('_', ' ')}: ${Array.isArray(value) ? value[0] : String(value)}`,
  );
  return messages.length ? messages.join(' · ') : null;
}

function RespondForm({ query, onSent }: { query: AdminQueryDetail; onSent: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => initialFilters(query));
  const [filters, setFilters] = useState(draft);
  const [filterErrors, setFilterErrors] = useState<OfferingFilterErrors>({});
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Map<number, AdminOffering>>(new Map());
  const [custom, setCustom] = useState<OfferingFormValues[]>([]);
  const [customErrors, setCustomErrors] = useState<(string | null)[]>([]);
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const customForm = useForm<OfferingFormValues>({
    resolver: zodResolver(offeringSchema(true)),
    defaultValues: customOfferingDefaults(query),
  });

  const offerings = useQuery({
    queryKey: ['admin', 'offerings', 'respond', filters, page],
    queryFn: async () => {
      const params = { ...offeringFilterParams(filters), is_active: 'true', page };
      return (await api.get<Paginated<AdminOffering>>('/admin/offerings', { params })).data;
    },
    placeholderData: keepPreviousData,
  });

  const search = () => {
    const found = validateOfferingFilters(draft);
    setFilterErrors(found);
    if (Object.keys(found).length === 0) {
      setFilters(draft);
      setPage(1);
    }
  };

  const toggle = (offering: AdminOffering) => {
    const next = new Map(selected);
    if (next.has(offering.id)) {
      next.delete(offering.id);
    } else {
      next.set(offering.id, offering);
    }
    setSelected(next);
  };

  const addCustom = customForm.handleSubmit((values) => {
    setCustom([...custom, values]);
    setCustomErrors([...customErrors, null]);
    customForm.reset(customOfferingDefaults(query));
  });

  const removeCustom = (index: number) => {
    setCustom(custom.filter((_, i) => i !== index));
    setCustomErrors(customErrors.filter((_, i) => i !== index));
  };

  const send = async () => {
    setFormError(null);
    if (selected.size === 0 && custom.length === 0) {
      setFormError('Select or add at least one offering.');
      return;
    }
    setSending(true);
    try {
      await api.post(`/admin/queries/${query.id}/respond`, {
        message: message.trim(),
        offering_ids: [...selected.keys()],
        new_offerings: custom.map((values) => ({ ...toOfferingBody(values), is_public: false })),
      });
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      onSent();
    } catch (error) {
      const body = isAxiosError(error) ? (error.response?.data as Record<string, unknown> | undefined) : undefined;
      if (body && Array.isArray(body.new_offerings)) {
        setCustomErrors(body.new_offerings.map(itemErrors));
        setFormError('Some custom offerings need fixing.');
      } else {
        setFormError(errorMessage(error));
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen maxWidth={1000}>
      <Text style={styles.title}>Respond to {query.user.full_name}</Text>
      <Card>
        <QuerySummary query={query} />
      </Card>

      <Text style={styles.section}>Existing offerings</Text>
      <Card>
        <OfferingFilterFields value={draft} onChange={setDraft} errors={filterErrors} onSubmit={search} />
        <View style={styles.actions}>
          <Button title="Search offerings" variant="secondary" onPress={search} />
        </View>
        {offerings.isPending ? (
          <LoadingState />
        ) : offerings.isError ? (
          <ErrorState error={offerings.error} onRetry={() => offerings.refetch()} />
        ) : offerings.data.results.length === 0 ? (
          <EmptyState message="No active offerings match. Add a custom one below." />
        ) : (
          <>
            {offerings.data.results.map((offering) => (
              <SelectableOffering
                key={offering.id}
                offering={offering}
                selected={selected.has(offering.id)}
                onToggle={() => toggle(offering)}
              />
            ))}
            <Pagination page={page} count={offerings.data.count} onChange={setPage} />
          </>
        )}
      </Card>

      <Text style={styles.section}>Custom offerings</Text>
      <Text style={styles.muted}>Created only for this customer; they never appear in Explore.</Text>
      <Card>
        <OfferingFields control={customForm.control} showPublicToggle={false} />
        <View style={styles.actions}>
          <Button title="Add custom offering" variant="secondary" onPress={addCustom} />
        </View>
      </Card>

      <Text style={styles.section}>Your response</Text>
      <Card>
        {selected.size === 0 && custom.length === 0 ? <Text style={styles.muted}>No offerings chosen yet.</Text> : null}
        {[...selected.values()].map((offering) => (
          <View key={offering.id} style={styles.chosen}>
            <Text style={styles.chosenText}>{offeringLine(offering)}</Text>
            <Button title="Remove" variant="link" onPress={() => toggle(offering)} />
          </View>
        ))}
        {custom.map((values, index) => (
          <View key={index} style={styles.chosenBlock}>
            <View style={styles.chosen}>
              <Text style={styles.chosenText}>
                Custom: {values.origin?.code} → {values.destination?.code}, {formatDate(values.departure_date)},{' '}
                {values.airline}, {ticketClassLabel(values.ticket_class)}, {stopoversLabel(Number(values.stopovers))},{' '}
                {formatPrice(values.price)}
              </Text>
              <Button title="Remove" variant="link" onPress={() => removeCustom(index)} />
            </View>
            {customErrors[index] ? <Text style={styles.error}>{customErrors[index]}</Text> : null}
          </View>
        ))}
        <Field label="Message to the customer (optional)">
          <TextInput
            style={[inputStyle, styles.message]}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={4}
            accessibilityLabel="Message to the customer"
            placeholder="e.g. These are the best fares I found for your dates."
            placeholderTextColor="#98a2ad"
          />
        </Field>
        <FormError message={formError} />
        <View style={styles.actions}>
          <Button title="Send response" onPress={send} loading={sending} />
        </View>
      </Card>
    </Screen>
  );
}

function offeringLine(offering: AdminOffering): string {
  return [
    `${offering.origin.code} → ${offering.destination.code}`,
    formatDate(offering.departure_date),
    offering.airline,
    ticketClassLabel(offering.ticket_class),
    stopoversLabel(offering.stopovers),
    formatPrice(offering.price),
    offering.is_public ? 'public' : 'private',
  ].join(', ');
}

type SelectableProps = { offering: AdminOffering; selected: boolean; onToggle: () => void };

function SelectableOffering({ offering, selected, onToggle }: SelectableProps) {
  const disabled = !offering.is_bookable;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onToggle}
      style={[styles.option, selected && styles.optionSelected, disabled && styles.optionDisabled]}
    >
      <View style={[styles.box, selected && styles.boxSelected]}>
        {selected ? <Text style={styles.tick}>✓</Text> : null}
      </View>
      <View style={styles.optionText}>
        <Text style={styles.text}>{offeringLine(offering)}</Text>
        <Text style={styles.muted}>
          {disabled ? 'No longer bookable' : `Valid until ${formatDate(offering.valid_until)}`}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  section: { fontSize: 18, fontWeight: '700', color: colors.text },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
  },
  optionSelected: { borderColor: colors.primary, backgroundColor: '#e3eef5' },
  optionDisabled: { opacity: 0.5 },
  optionText: { flexShrink: 1 },
  box: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  tick: { color: colors.primaryText, fontSize: 12, fontWeight: '700' },
  chosenBlock: { gap: 2 },
  chosen: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  chosenText: { color: colors.text, flexShrink: 1 },
  message: { minHeight: 90, textAlignVertical: 'top' },
  text: { color: colors.text },
  muted: { color: colors.muted },
  error: { color: colors.danger, fontSize: 13 },
});
