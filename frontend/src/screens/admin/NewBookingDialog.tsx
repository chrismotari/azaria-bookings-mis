import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage, firstMessage } from '../../api/errors';
import { AdminBookingDetail, AdminCustomer, AdminOffer, Paginated } from '../../api/types';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Field, inputStyle } from '../../components/Field';
import { FormSection } from '../../components/FormSection';
import {
  EMPTY_OFFER_FILTERS,
  OfferFilterErrors,
  OfferFilterFields,
  offerFilterParams,
  validateOfferFilters,
} from '../../components/OfferFilterFields';
import { Pagination } from '../../components/Pagination';
import { PressState } from '../../components/pressState';
import { PriceTag } from '../../components/PriceTag';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { Stepper } from '../../components/Stepper';
import { TextField } from '../../components/TextField';
import { colors, font, space, weight } from '../../theme';
import { formatPrice } from '../../utils/format';
import { useDebounced } from '../../utils/useDebounced';
import { SelectableOffer } from './OfferOptions';

const MIN_PASSENGERS = 1;
const MAX_PASSENGERS = 9;

type Errors = Partial<Record<'user' | 'offer' | 'passenger_count' | 'notes', string>>;

/** The first message of each field the server rejected. */
function fieldErrors(error: unknown): Errors | null {
  const body = isAxiosError(error) ? error.response?.data : undefined;
  if (!body || typeof body !== 'object' || 'detail' in body) {
    return null;
  }
  const found: Errors = {};
  for (const field of ['user', 'offer', 'passenger_count', 'notes'] as const) {
    const message = firstMessage((body as Record<string, unknown>)[field]);
    if (message) {
      found[field] = message;
    }
  }
  return Object.keys(found).length ? found : null;
}

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (booking: AdminBookingDetail) => void;
};

/** The admin books a flight for a customer, who is not emailed: the admin made the booking. */
export function NewBookingDialog({ open, onClose, onCreated }: Props) {
  // A fresh form each time the dialog opens.
  return open ? <NewBookingForm onClose={onClose} onCreated={onCreated} /> : null;
}

function NewBookingForm({ onClose, onCreated }: Omit<Props, 'open'>) {
  const queryClient = useQueryClient();
  const [customer, setCustomer] = useState<AdminCustomer | null>(null);
  const [offer, setOffer] = useState<AdminOffer | null>(null);
  const [passengers, setPassengers] = useState(1);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const missing: Errors = {};
    if (!customer) {
      missing.user = 'Choose a customer.';
    }
    if (!offer) {
      missing.offer = 'Choose an offer.';
    }
    setErrors(missing);
    setFormError(null);
    if (!customer || !offer) {
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post<AdminBookingDetail>('/admin/bookings', {
        user: customer.id,
        offer: offer.id,
        passenger_count: passengers,
        notes: notes.trim(),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'bookings'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] }),
      ]);
      onCreated(data);
    } catch (error) {
      const found = fieldErrors(error);
      if (found) {
        setErrors(found);
      } else {
        setFormError(errorMessage(error));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title="New booking"
      size="large"
      onClose={onClose}
      busy={saving}
      error={formError}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={saving} />
          <Button title="Create booking" onPress={submit} loading={saving} />
        </>
      }
    >
      <Text style={styles.text}>
        Book a flight for a customer, e.g. one who called. The customer is not emailed now; they are emailed as usual
        once you confirm availability.
      </Text>
      <FormSection title="Customer" plain>
        <CustomerPicker
          value={customer}
          onChange={(chosen) => {
            setCustomer(chosen);
            setErrors(({ user: _, ...rest }) => rest);
          }}
          error={errors.user}
        />
      </FormSection>
      <FormSection title="Offer" description="Bookable offers, public or private." plain>
        <OfferPicker
          value={offer}
          onChange={(chosen) => {
            setOffer(chosen);
            setErrors(({ offer: _, ...rest }) => rest);
          }}
          error={errors.offer}
        />
      </FormSection>
      <FormSection title="Passengers and notes" plain>
        <Stepper
          label="Passengers"
          value={passengers}
          min={MIN_PASSENGERS}
          max={MAX_PASSENGERS}
          onChange={setPassengers}
          decreaseLabel="Remove a passenger"
          increaseLabel="Add a passenger"
          error={errors.passenger_count}
        />
        <TextField
          label="Notes (optional)"
          placeholder="e.g. seating or meal preferences"
          value={notes}
          onChangeText={setNotes}
          error={errors.notes}
          multiline
          numberOfLines={3}
        />
        <View style={styles.total}>
          <View>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.muted}>
              {offer ? `${passengers} × ${formatPrice(offer.price)}` : 'Choose an offer to see the total.'}
            </Text>
          </View>
          {offer ? <PriceTag amount={Number(offer.price) * passengers} size="large" /> : null}
        </View>
      </FormSection>
    </Dialog>
  );
}

type CustomerPickerProps = {
  value: AdminCustomer | null;
  onChange: (customer: AdminCustomer | null) => void;
  error?: string;
};

/** Search of active customers by name, email or phone; the value is a chosen customer. */
function CustomerPicker({ value, onChange, error }: CustomerPickerProps) {
  const [text, setText] = useState('');
  const search = useDebounced(text.trim(), 250);
  const results = useQuery({
    queryKey: ['admin', 'users', 'picker', search],
    queryFn: async () => {
      const params = { is_active: 'true', ...(search ? { search } : {}) };
      return (await api.get<Paginated<AdminCustomer>>('/admin/users', { params })).data;
    },
    enabled: value === null,
    placeholderData: keepPreviousData,
  });

  if (value) {
    return (
      <Field label="Customer" error={error}>
        <View style={[inputStyle, styles.selected]}>
          <Text style={styles.selectedText} numberOfLines={1}>
            {value.full_name} · {value.email}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => onChange(null)}>
            <Text style={styles.change}>Change</Text>
          </Pressable>
        </View>
      </Field>
    );
  }
  const shown = results.data?.results.slice(0, 6) ?? [];
  return (
    <View style={styles.picker}>
      <TextField
        label="Customer"
        value={text}
        onChangeText={setText}
        placeholder="Search active customers by name, email or phone"
        error={error}
        autoCorrect={false}
        autoCapitalize="none"
      />
      <View style={styles.results}>
        {results.isPending ? <ActivityIndicator color={colors.primary} style={styles.message} /> : null}
        {results.isError ? <Text style={styles.message}>Could not search customers.</Text> : null}
        {results.data && shown.length === 0 ? <Text style={styles.message}>No active customers match.</Text> : null}
        {shown.map((customer) => (
          <Pressable
            key={customer.id}
            accessibilityRole="button"
            accessibilityLabel={`${customer.full_name}, ${customer.email}`}
            onPress={() => onChange(customer)}
            style={({ pressed, hovered }: PressState) => [styles.option, (pressed || hovered) && styles.pressed]}
          >
            <Text style={styles.optionName}>{customer.full_name}</Text>
            <Text style={styles.optionText} numberOfLines={1}>
              {customer.email}
              {customer.phone ? ` · ${customer.phone}` : ''}
            </Text>
          </Pressable>
        ))}
        {results.data && results.data.count > shown.length ? (
          <Text style={styles.message}>More customers match: keep typing to narrow the list.</Text>
        ) : null}
      </View>
    </View>
  );
}

type OfferPickerProps = {
  value: AdminOffer | null;
  onChange: (offer: AdminOffer | null) => void;
  error?: string;
};

/** The offer search of the Respond screen, choosing exactly one offer. */
function OfferPicker({ value, onChange, error }: OfferPickerProps) {
  const [draft, setDraft] = useState(EMPTY_OFFER_FILTERS);
  const [filters, setFilters] = useState(EMPTY_OFFER_FILTERS);
  const [filterErrors, setFilterErrors] = useState<OfferFilterErrors>({});
  const [page, setPage] = useState(1);
  const offers = useQuery({
    queryKey: ['admin', 'offers', 'new-booking', filters, page],
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

  return (
    <View style={styles.picker}>
      <OfferFilterFields value={draft} onChange={setDraft} errors={filterErrors} onSubmit={search} />
      <View style={styles.actions}>
        <Button title="Search offers" variant="secondary" onPress={search} />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {offers.isPending ? (
        <LoadingState />
      ) : offers.isError ? (
        <ErrorState error={offers.error} onRetry={() => offers.refetch()} />
      ) : offers.data.results.length === 0 ? (
        <EmptyState icon="search-outline" title="No matching offers" message="No active offers match this search." />
      ) : (
        <>
          {offers.data.results.map((offer) => (
            <SelectableOffer
              key={offer.id}
              kind="radio"
              offer={offer}
              selected={value?.id === offer.id}
              onToggle={() => onChange(value?.id === offer.id ? null : offer)}
            />
          ))}
          <Pagination page={page} count={offers.data.count} onChange={setPage} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  text: { color: colors.text, fontSize: font.body },
  muted: { color: colors.muted },
  error: { color: colors.dangerText, fontSize: font.small },
  picker: { gap: space.sm },
  actions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  selected: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  selectedText: { color: colors.text, flexShrink: 1 },
  change: { color: colors.primary, fontWeight: weight.bold },
  results: { borderWidth: 1, borderColor: colors.border, borderRadius: 6, overflow: 'hidden' },
  message: { padding: space.md, color: colors.muted },
  option: { paddingVertical: space.sm, paddingHorizontal: space.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  pressed: { backgroundColor: colors.primaryTint },
  optionName: { color: colors.text, fontWeight: weight.semibold },
  optionText: { color: colors.muted, fontSize: font.small },
  total: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalLabel: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
});
