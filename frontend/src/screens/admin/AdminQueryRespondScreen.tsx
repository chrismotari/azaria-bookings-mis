import { zodResolver } from '@hookform/resolvers/zod';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { AdminOffer, AdminQueryDetail, Paginated } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Field, FormError, inputStyle } from '../../components/Field';
import {
  OfferFilterErrors,
  OfferFilterFields,
  OfferFilterValues,
  offerFilterParams,
  validateOfferFilters,
} from '../../components/OfferFilterFields';
import { Pagination } from '../../components/Pagination';
import { QuerySummary } from '../../components/QuerySummary';
import { Screen } from '../../components/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { RootStackParamList } from '../../navigation/types';
import { colors } from '../../theme';
import { formatDate, formatPrice, stopoversLabel, ticketClassLabel, todayInNairobi } from '../../utils/format';
import { useAdminQuery } from './AdminQueryDetailScreen';
import { OfferFields } from './OfferFields';
import { OfferFormValues, offerSchema, toOfferBody } from './offerSchema';

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

/** Existing-offer search starts from the customer's own criteria. */
function initialFilters(query: AdminQueryDetail): OfferFilterValues {
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

function customOfferDefaults(query: AdminQueryDetail): OfferFormValues {
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

/** First message of each field error the server returned for one new offer. */
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
  const [filterErrors, setFilterErrors] = useState<OfferFilterErrors>({});
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Map<number, AdminOffer>>(new Map());
  const [custom, setCustom] = useState<OfferFormValues[]>([]);
  const [customErrors, setCustomErrors] = useState<(string | null)[]>([]);
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const customForm = useForm<OfferFormValues>({
    resolver: zodResolver(offerSchema(true)),
    defaultValues: customOfferDefaults(query),
  });

  const offers = useQuery({
    queryKey: ['admin', 'offers', 'respond', filters, page],
    queryFn: async () => {
      const params = { ...offerFilterParams(filters), is_active: 'true', page };
      return (await api.get<Paginated<AdminOffer>>('/admin/offers', { params })).data;
    },
    placeholderData: keepPreviousData,
  });

  const search = () => {
    const found = validateOfferFilters(draft);
    setFilterErrors(found);
    if (Object.keys(found).length === 0) {
      setFilters(draft);
      setPage(1);
    }
  };

  const toggle = (offer: AdminOffer) => {
    const next = new Map(selected);
    if (next.has(offer.id)) {
      next.delete(offer.id);
    } else {
      next.set(offer.id, offer);
    }
    setSelected(next);
  };

  const addCustom = customForm.handleSubmit((values) => {
    setCustom([...custom, values]);
    setCustomErrors([...customErrors, null]);
    customForm.reset(customOfferDefaults(query));
  });

  const removeCustom = (index: number) => {
    setCustom(custom.filter((_, i) => i !== index));
    setCustomErrors(customErrors.filter((_, i) => i !== index));
  };

  const send = async () => {
    setFormError(null);
    if (selected.size === 0 && custom.length === 0) {
      setFormError('Select or add at least one offer.');
      return;
    }
    setSending(true);
    try {
      await api.post(`/admin/queries/${query.id}/respond`, {
        message: message.trim(),
        offer_ids: [...selected.keys()],
        new_offers: custom.map((values) => ({ ...toOfferBody(values), is_public: false })),
      });
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      onSent();
    } catch (error) {
      const body = isAxiosError(error) ? (error.response?.data as Record<string, unknown> | undefined) : undefined;
      if (body && Array.isArray(body.new_offers)) {
        setCustomErrors(body.new_offers.map(itemErrors));
        setFormError('Some custom offers need fixing.');
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

      <Text style={styles.section}>Existing offers</Text>
      <Card>
        <OfferFilterFields value={draft} onChange={setDraft} errors={filterErrors} onSubmit={search} />
        <View style={styles.actions}>
          <Button title="Search offers" variant="secondary" onPress={search} />
        </View>
        {offers.isPending ? (
          <LoadingState />
        ) : offers.isError ? (
          <ErrorState error={offers.error} onRetry={() => offers.refetch()} />
        ) : offers.data.results.length === 0 ? (
          <EmptyState message="No active offers match. Add a custom one below." />
        ) : (
          <>
            {offers.data.results.map((offer) => (
              <SelectableOffer
                key={offer.id}
                offer={offer}
                selected={selected.has(offer.id)}
                onToggle={() => toggle(offer)}
              />
            ))}
            <Pagination page={page} count={offers.data.count} onChange={setPage} />
          </>
        )}
      </Card>

      <Text style={styles.section}>Custom offers</Text>
      <Text style={styles.muted}>Created only for this customer; they never appear in Explore.</Text>
      <Card>
        <OfferFields control={customForm.control} showPublicToggle={false} />
        <View style={styles.actions}>
          <Button title="Add custom offer" variant="secondary" onPress={addCustom} />
        </View>
      </Card>

      <Text style={styles.section}>Your response</Text>
      <Card>
        {selected.size === 0 && custom.length === 0 ? <Text style={styles.muted}>No offers chosen yet.</Text> : null}
        {[...selected.values()].map((offer) => (
          <View key={offer.id} style={styles.chosen}>
            <Text style={styles.chosenText}>{offerLine(offer)}</Text>
            <Button title="Remove" variant="link" onPress={() => toggle(offer)} />
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
            placeholderTextColor={colors.placeholder}
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

function offerLine(offer: AdminOffer): string {
  return [
    `${offer.origin.code} → ${offer.destination.code}`,
    formatDate(offer.departure_date),
    offer.airline,
    ticketClassLabel(offer.ticket_class),
    stopoversLabel(offer.stopovers),
    formatPrice(offer.price),
    offer.is_public ? 'public' : 'private',
  ].join(', ');
}

type SelectableProps = { offer: AdminOffer; selected: boolean; onToggle: () => void };

function SelectableOffer({ offer, selected, onToggle }: SelectableProps) {
  const disabled = !offer.is_bookable;
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
        <Text style={styles.text}>{offerLine(offer)}</Text>
        <Text style={styles.muted}>
          {disabled ? 'No longer bookable' : `Valid until ${formatDate(offer.valid_until)}`}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  section: { fontSize: 18, fontWeight: '700', color: colors.tertiary },
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
  optionSelected: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
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
