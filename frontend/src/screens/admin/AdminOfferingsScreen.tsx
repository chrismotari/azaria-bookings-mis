import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigation } from '@react-navigation/native';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { AdminOffering, Paginated, TICKET_CLASSES, TicketClass } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DateField } from '../../components/DateField';
import { FieldGrid, FormError } from '../../components/Field';
import { OptionChips } from '../../components/OptionChips';
import { Pagination } from '../../components/Pagination';
import { Screen } from '../../components/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { TextField } from '../../components/TextField';
import { Toggle } from '../../components/Toggle';
import { colors, useIsWide } from '../../theme';
import { formatDate, formatPrice, ticketClassLabel } from '../../utils/format';

const optionalAmount = z
  .string()
  .trim()
  .regex(/^(\d{1,8}(\.\d{1,2})?)?$/, 'Enter an amount, e.g. 500.');

const filterSchema = z
  .object({
    origin: z.string(),
    destination: z.string(),
    date_from: z.string(),
    date_to: z.string(),
    price_min: optionalAmount,
    price_max: optionalAmount,
    ticket_class: z.enum(['', 'economy', 'premium_economy', 'business', 'first']),
    max_stopovers: z
      .string()
      .trim()
      .regex(/^(\d{1,2})?$/, 'Enter a whole number.'),
    is_active: z.enum(['', 'true', 'false']),
    is_public: z.enum(['', 'true', 'false']),
  })
  .superRefine((values, ctx) => {
    if (values.date_from && values.date_to && values.date_from > values.date_to) {
      ctx.addIssue({ code: 'custom', path: ['date_to'], message: 'Must be on or after the start date.' });
    }
    if (values.price_min && values.price_max && Number(values.price_min) > Number(values.price_max)) {
      ctx.addIssue({ code: 'custom', path: ['price_max'], message: 'Must be at least the minimum price.' });
    }
  });

type Filters = z.infer<typeof filterSchema>;

const EMPTY_FILTERS: Filters = {
  origin: '',
  destination: '',
  date_from: '',
  date_to: '',
  price_min: '',
  price_max: '',
  ticket_class: '',
  max_stopovers: '',
  is_active: '',
  is_public: '',
};

const FILTER_LABELS = { price_min: 'Min price (USD)', price_max: 'Max price (USD)', max_stopovers: 'Max stopovers' };

const CLASS_OPTIONS: { value: '' | TicketClass; label: string }[] = [{ value: '', label: 'Any' }, ...TICKET_CLASSES];

const YES_NO_ANY = (yes: string, no: string): { value: '' | 'true' | 'false'; label: string }[] => [
  { value: '', label: 'All' },
  { value: 'true', label: yes },
  { value: 'false', label: no },
];

export function AdminOfferingsScreen() {
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const isWide = useIsWide();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const form = useForm<Filters>({ resolver: zodResolver(filterSchema), defaultValues: EMPTY_FILTERS });

  const offerings = useQuery({
    queryKey: ['admin', 'offerings', filters, page],
    queryFn: async () => {
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value.trim() !== ''));
      return (await api.get<Paginated<AdminOffering>>('/admin/offerings', { params: { ...params, page } })).data;
    },
    placeholderData: keepPreviousData,
  });

  const setActive = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      api.patch(`/admin/offerings/${id}`, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'offerings'] }),
  });

  const apply = form.handleSubmit((values) => {
    setFilters(values);
    setPage(1);
  });

  const clear = () => {
    form.reset(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Offerings</Text>
        <Button title="New offering" onPress={() => navigation.navigate('AdminOfferingNew')} />
      </View>

      {!isWide ? (
        <Button
          title={filtersOpen ? 'Hide filters' : 'Show filters'}
          variant="secondary"
          onPress={() => setFiltersOpen((open) => !open)}
        />
      ) : null}

      {isWide || filtersOpen ? (
        <Card>
          <FieldGrid>
            {(['origin', 'destination'] as const).map((name) => (
              <Controller
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <TextField
                    label={name === 'origin' ? 'From' : 'To'}
                    placeholder="City, country or code"
                    value={field.value}
                    onChangeText={field.onChange}
                    onSubmitEditing={() => apply()}
                  />
                )}
              />
            ))}
            {(['date_from', 'date_to'] as const).map((name) => (
              <Controller
                key={name}
                control={form.control}
                name={name}
                render={({ field, fieldState }) => (
                  <DateField
                    label={name === 'date_from' ? 'Departing from' : 'Departing until'}
                    value={field.value}
                    onChange={field.onChange}
                    error={fieldState.error?.message}
                  />
                )}
              />
            ))}
            {(['price_min', 'price_max', 'max_stopovers'] as const).map((name) => (
              <Controller
                key={name}
                control={form.control}
                name={name}
                render={({ field, fieldState }) => (
                  <TextField
                    label={FILTER_LABELS[name]}
                    value={field.value}
                    onChangeText={field.onChange}
                    error={fieldState.error?.message}
                    keyboardType={name === 'max_stopovers' ? 'number-pad' : 'decimal-pad'}
                    onSubmitEditing={() => apply()}
                  />
                )}
              />
            ))}
          </FieldGrid>
          <Controller
            control={form.control}
            name="ticket_class"
            render={({ field }) => (
              <OptionChips label="Class" options={CLASS_OPTIONS} value={field.value} onChange={field.onChange} />
            )}
          />
          <FieldGrid>
            <Controller
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <OptionChips
                  label="Active"
                  options={YES_NO_ANY('Active', 'Deactivated')}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <Controller
              control={form.control}
              name="is_public"
              render={({ field }) => (
                <OptionChips
                  label="Visibility"
                  options={YES_NO_ANY('Public', 'Private')}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </FieldGrid>
          <View style={styles.actions}>
            <Button title="Apply filters" onPress={apply} />
            <Button title="Clear" variant="secondary" onPress={clear} />
          </View>
        </Card>
      ) : null}

      <FormError message={setActive.isError ? errorMessage(setActive.error) : null} />

      {offerings.isPending ? (
        <LoadingState />
      ) : offerings.isError ? (
        <ErrorState error={offerings.error} onRetry={() => offerings.refetch()} />
      ) : offerings.data.results.length === 0 ? (
        <EmptyState message="No offerings match these filters." />
      ) : (
        <>
          <Text style={styles.count}>
            {offerings.data.count} offering{offerings.data.count === 1 ? '' : 's'}
          </Text>
          <View style={isWide ? styles.table : styles.cards}>
            {isWide ? <TableHeader /> : null}
            {offerings.data.results.map((offering) => (
              <OfferingRow
                key={offering.id}
                offering={offering}
                wide={isWide}
                toggling={setActive.isPending && setActive.variables?.id === offering.id}
                onToggleActive={(is_active) => setActive.mutate({ id: offering.id, is_active })}
                onEdit={() => navigation.navigate('AdminOfferingEdit', { id: offering.id })}
              />
            ))}
          </View>
          <Pagination page={page} count={offerings.data.count} onChange={setPage} />
        </>
      )}
    </Screen>
  );
}

function TableHeader() {
  return (
    <View style={[styles.tableRow, styles.tableHeader]}>
      <Text style={[styles.th, styles.colRoute]}>Route</Text>
      <Text style={[styles.th, styles.colDates]}>Departure / valid until</Text>
      <Text style={[styles.th, styles.colFlight]}>Flight</Text>
      <Text style={[styles.th, styles.colPrice]}>Price</Text>
      <Text style={[styles.th, styles.colStatus]}>Status</Text>
      <Text style={[styles.th, styles.colActions]}>Active</Text>
    </View>
  );
}

type RowProps = {
  offering: AdminOffering;
  wide: boolean;
  toggling: boolean;
  onToggleActive: (value: boolean) => void;
  onEdit: () => void;
};

function OfferingRow({ offering, wide, toggling, onToggleActive, onEdit }: RowProps) {
  const route = `${offering.origin.code} → ${offering.destination.code}`;
  const cities = `${offering.origin.city} → ${offering.destination.city}`;
  const flight = `${offering.airline} · ${ticketClassLabel(offering.ticket_class)} · ${
    offering.stopovers === 0 ? 'Direct' : `${offering.stopovers} stop${offering.stopovers === 1 ? '' : 's'}`
  }`;
  const status = [
    offering.is_public ? 'Public' : 'Private',
    offering.is_bookable ? 'Bookable' : offering.is_active ? 'Lapsed' : 'Deactivated',
  ].join(' · ');
  const toggle = (
    <Toggle
      label={offering.is_active ? 'Active' : 'Inactive'}
      value={offering.is_active}
      onChange={onToggleActive}
      disabled={toggling}
    />
  );

  if (wide) {
    return (
      <View style={styles.tableRow}>
        <View style={styles.colRoute}>
          <Text style={styles.strong}>{route}</Text>
          <Text style={styles.muted}>{cities}</Text>
        </View>
        <View style={styles.colDates}>
          <Text style={styles.cell}>{formatDate(offering.departure_date)}</Text>
          <Text style={styles.muted}>until {formatDate(offering.valid_until)}</Text>
        </View>
        <Text style={[styles.cell, styles.colFlight]}>{flight}</Text>
        <Text style={[styles.strong, styles.colPrice]}>{formatPrice(offering.price)}</Text>
        <Text style={[styles.cell, styles.colStatus]}>{status}</Text>
        <View style={[styles.colActions, styles.rowActions]}>
          {toggle}
          <Button title="Edit" variant="link" onPress={onEdit} />
        </View>
      </View>
    );
  }

  return (
    <Card>
      <View style={styles.cardTop}>
        <View style={styles.shrink}>
          <Text style={styles.strong}>{route}</Text>
          <Text style={styles.muted}>{cities}</Text>
        </View>
        <Text style={styles.strong}>{formatPrice(offering.price)}</Text>
      </View>
      <Text style={styles.cell}>
        {formatDate(offering.departure_date)} · valid until {formatDate(offering.valid_until)}
      </Text>
      <Text style={styles.cell}>{flight}</Text>
      <Text style={styles.muted}>{status}</Text>
      <View style={styles.cardTop}>
        {toggle}
        <Button title="Edit" variant="secondary" onPress={onEdit} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  count: { color: colors.muted },
  cards: { gap: 12 },
  table: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden' },
  tableHeader: { backgroundColor: colors.background },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  th: { fontSize: 12, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' },
  colRoute: { flex: 2, minWidth: 0 },
  colDates: { flex: 2, minWidth: 0 },
  colFlight: { flex: 3, minWidth: 0 },
  colPrice: { flex: 1.3, minWidth: 0 },
  colStatus: { flex: 2, minWidth: 0 },
  colActions: { flex: 2.2, minWidth: 0 },
  rowActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  cell: { color: colors.text },
  strong: { color: colors.text, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 13 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  shrink: { flexShrink: 1 },
});
