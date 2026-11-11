import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { api } from '../../api/client';
import { firstMessage } from '../../api/errors';
import { AdminOffer, Paginated } from '../../api/types';
import { AirlineBadge } from '../../components/AirlineBadge';
import { Button } from '../../components/Button';
import { Field, inputStyle } from '../../components/Field';
import { FormSection } from '../../components/FormSection';
import {
  OfferFilterErrors,
  OfferFilterFields,
  OfferFilterValues,
  offerFilterParams,
  validateOfferFilters,
} from '../../components/OfferFilterFields';
import { Pagination } from '../../components/Pagination';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { colors, font, weight } from '../../theme';
import { formatDate, formatPrice, stopsLabel, ticketClassLabel } from '../../utils/format';
import { OfferFields } from './OfferFields';
import { OfferFormValues, offerSchema, toOfferBody } from './offerSchema';

/** First message of each field error the server returned for one new offer. */
function itemErrors(errors: unknown): string | null {
  if (!errors || typeof errors !== 'object') {
    return null;
  }
  const messages = Object.entries(errors as Record<string, unknown>).flatMap(([field, value]) => {
    const message = firstMessage(value);
    return message ? [`${field.replaceAll('_', ' ')}: ${message}`] : [];
  });
  return messages.length ? messages.join(' · ') : null;
}

/** Existing offers found by search plus custom (always private) ones; shared by Respond and Mark unavailable. */
export function useOfferOptions(initialFilters: OfferFilterValues, customDefaults: OfferFormValues) {
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [filterErrors, setFilterErrors] = useState<OfferFilterErrors>({});
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Map<string, AdminOffer>>(new Map());
  const [custom, setCustom] = useState<OfferFormValues[]>([]);
  const [customErrors, setCustomErrors] = useState<(string | null)[]>([]);

  const customForm = useForm<OfferFormValues>({
    resolver: zodResolver(offerSchema(true)),
    defaultValues: customDefaults,
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
    customForm.reset(customDefaults);
  });

  const removeCustom = (index: number) => {
    setCustom(custom.filter((_, i) => i !== index));
    setCustomErrors(customErrors.filter((_, i) => i !== index));
  };

  return {
    draft,
    setDraft,
    filterErrors,
    search,
    page,
    setPage,
    offers,
    selected,
    toggle,
    custom,
    customErrors,
    customForm,
    addCustom,
    removeCustom,
    count: selected.size + custom.length,
    /** offer_ids and new_offers, as the respond and mark-unavailable endpoints take them. */
    body: () => ({
      offer_ids: [...selected.keys()],
      new_offers: custom.map((values) => ({ ...toOfferBody(values), is_public: false })),
    }),
    /** Shows the server's errors for each custom offer; false when the error was not about them. */
    applyErrors: (error: unknown): boolean => {
      const body = isAxiosError(error) ? (error.response?.data as Record<string, unknown> | undefined) : undefined;
      if (body && Array.isArray(body.new_offers)) {
        setCustomErrors(body.new_offers.map(itemErrors));
        return true;
      }
      return false;
    },
  };
}

type OfferOptions = ReturnType<typeof useOfferOptions>;

type SectionsProps = {
  options: OfferOptions;
  existingDescription: string;
  /** Draws the sections without their own cards, e.g. inside a dialog. */
  plain?: boolean;
};

/** The "Existing offers" search with selectable results and the "Custom offers" form. */
export function OfferOptionsSections({ options, existingDescription, plain }: SectionsProps) {
  const { offers } = options;
  return (
    <>
      <FormSection title="Existing offers" description={existingDescription} plain={plain}>
        <OfferFilterFields
          value={options.draft}
          onChange={options.setDraft}
          errors={options.filterErrors}
          onSubmit={options.search}
        />
        <View style={styles.actions}>
          <Button title="Search offers" variant="secondary" onPress={options.search} />
        </View>
        {offers.isPending ? (
          <LoadingState />
        ) : offers.isError ? (
          <ErrorState error={offers.error} onRetry={() => offers.refetch()} />
        ) : offers.data.results.length === 0 ? (
          <EmptyState
            icon="search-outline"
            title="No matching offers"
            message="No active offers match. Add a custom one below."
          />
        ) : (
          <>
            {offers.data.results.map((offer) => (
              <SelectableOffer
                key={offer.id}
                offer={offer}
                selected={options.selected.has(offer.id)}
                onToggle={() => options.toggle(offer)}
              />
            ))}
            <Pagination page={options.page} count={offers.data.count} onChange={options.setPage} />
          </>
        )}
      </FormSection>

      <FormSection
        title="Custom offers"
        description="Created only for this customer; they never appear in Explore."
        plain={plain}
      >
        <OfferFields control={options.customForm.control} showPublicToggle={false} plain />
        <View style={styles.actions}>
          <Button title="Add custom offer" variant="secondary" onPress={options.addCustom} />
        </View>
      </FormSection>
    </>
  );
}

export function ChosenOffers({ options }: { options: OfferOptions }) {
  return (
    <>
      {options.count === 0 ? <Text style={styles.muted}>No offers chosen yet.</Text> : null}
      {[...options.selected.values()].map((offer) => (
        <View key={offer.id} style={styles.chosen}>
          <Text style={styles.chosenText}>{offerLine(offer)}</Text>
          <Button title="Remove" variant="link" onPress={() => options.toggle(offer)} />
        </View>
      ))}
      {options.custom.map((values, index) => (
        <View key={index} style={styles.chosenBlock}>
          <View style={styles.chosen}>
            <Text style={styles.chosenText}>
              Custom: {values.origin?.code} → {values.destination?.code}, {formatDate(values.departure_date)},{' '}
              {values.airline?.name}, {ticketClassLabel(values.ticket_class)}, {stopsLabel(values.stops.length)},{' '}
              {formatPrice(values.price)}
            </Text>
            <Button title="Remove" variant="link" onPress={() => options.removeCustom(index)} />
          </View>
          {options.customErrors[index] ? <Text style={styles.error}>{options.customErrors[index]}</Text> : null}
        </View>
      ))}
    </>
  );
}

export function MessageField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Field label="Message to the customer (optional)">
      <TextInput
        style={[inputStyle, styles.message]}
        value={value}
        onChangeText={onChange}
        multiline
        numberOfLines={4}
        accessibilityLabel="Message to the customer"
        placeholder="e.g. These are the best fares I found for your dates."
        placeholderTextColor={colors.placeholder}
      />
    </Field>
  );
}

function offerLine(offer: AdminOffer): string {
  return [
    `${offer.origin.code} → ${offer.destination.code}`,
    formatDate(offer.departure_date),
    offer.airline.name,
    ticketClassLabel(offer.ticket_class),
    stopsLabel(offer.stop_count),
    formatPrice(offer.price),
    offer.is_public ? 'public' : 'private',
  ].join(', ');
}

type SelectableProps = {
  offer: AdminOffer;
  selected: boolean;
  onToggle: () => void;
  /** Radio when exactly one offer is chosen (New booking); checkbox when several may be (Respond). */
  kind?: 'checkbox' | 'radio';
};

/** An offer in search results that can be chosen; offers that can no longer be booked are disabled. */
export function SelectableOffer({ offer, selected, onToggle, kind = 'checkbox' }: SelectableProps) {
  const disabled = !offer.is_bookable;
  return (
    <Pressable
      accessibilityRole={kind}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onToggle}
      style={[styles.option, selected && styles.optionSelected, disabled && styles.optionDisabled]}
    >
      <View style={[styles.box, kind === 'radio' && styles.round, selected && styles.boxSelected]}>
        {selected ? <Text style={styles.tick}>✓</Text> : null}
      </View>
      <AirlineBadge airline={offer.airline} size={32} />
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
  round: { borderRadius: 10 },
  boxSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  tick: { color: colors.primaryText, fontSize: font.caption, fontWeight: weight.bold },
  chosenBlock: { gap: 2 },
  chosen: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  chosenText: { color: colors.text, flexShrink: 1 },
  message: { minHeight: 90, textAlignVertical: 'top' },
  text: { color: colors.text },
  muted: { color: colors.muted },
  error: { color: colors.danger, fontSize: font.small },
});
