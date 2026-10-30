import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { AdminOffer, Paginated } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DetailLayout } from '../../components/DetailLayout';
import { FieldGrid, FormError } from '../../components/Field';
import {
  EMPTY_OFFER_FILTERS,
  OfferFilterErrors,
  OfferFilterFields,
  OfferFilterValues,
  offerFilterParams,
  validateOfferFilters,
} from '../../components/OfferFilterFields';
import { OptionChips } from '../../components/OptionChips';
import { Pagination } from '../../components/Pagination';
import { Screen } from '../../components/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { Toggle } from '../../components/Toggle';
import { AdminTabParamList } from '../../navigation/types';
import { colors, radius, shadow, useIsWide } from '../../theme';
import { formatDate, formatPrice, stopoversLabel, ticketClassLabel } from '../../utils/format';
import { AdminOfferEditView } from './AdminOfferFormScreen';

type AdminFilters = OfferFilterValues & { is_active: '' | 'true' | 'false'; is_public: '' | 'true' | 'false' };

const EMPTY_FILTERS: AdminFilters = { ...EMPTY_OFFER_FILTERS, is_active: '', is_public: '' };

const YES_NO_ANY = (yes: string, no: string): { value: '' | 'true' | 'false'; label: string }[] => [
  { value: '', label: 'All' },
  { value: 'true', label: yes },
  { value: 'false', label: no },
];

export function AdminOffersScreen({ navigation, route }: BottomTabScreenProps<AdminTabParamList, 'AdminOffers'>) {
  const rootNavigation = useNavigation();
  const queryClient = useQueryClient();
  const isWide = useIsWide();
  const selected = route.params?.id;
  const close = useCallback(() => navigation.setParams({ id: undefined }), [navigation]);
  // With the edit panel open the list is too narrow for the table.
  const asTable = isWide && selected === undefined;
  const [draft, setDraft] = useState<AdminFilters>(EMPTY_FILTERS);
  const [errors, setErrors] = useState<OfferFilterErrors>({});
  const [filters, setFilters] = useState<AdminFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const offers = useQuery({
    queryKey: ['admin', 'offers', filters, page],
    queryFn: async () => {
      const params = {
        ...offerFilterParams(filters),
        ...(filters.is_active ? { is_active: filters.is_active } : {}),
        ...(filters.is_public ? { is_public: filters.is_public } : {}),
        page,
      };
      return (await api.get<Paginated<AdminOffer>>('/admin/offers', { params })).data;
    },
    placeholderData: keepPreviousData,
  });

  const setActive = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      api.patch(`/admin/offers/${id}`, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'offers'] }),
  });

  const apply = () => {
    const found = validateOfferFilters(draft);
    setErrors(found);
    if (Object.keys(found).length === 0) {
      setFilters(draft);
      setPage(1);
    }
  };

  const clear = () => {
    setDraft(EMPTY_FILTERS);
    setErrors({});
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  return (
    <DetailLayout
      title="Edit offer"
      backLabel="All offers"
      onClose={close}
      detail={selected ? <AdminOfferEditView key={selected} id={selected} onDone={close} /> : null}
      list={
        <Screen>
          <View style={styles.header}>
            <Text style={styles.title}>Offers</Text>
            <Button title="New offer" onPress={() => rootNavigation.navigate('AdminOfferNew')} />
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
              <OfferFilterFields
                value={draft}
                onChange={(base) => setDraft({ ...draft, ...base })}
                errors={errors}
                onSubmit={apply}
              />
              <FieldGrid>
                <OptionChips
                  label="Active"
                  options={YES_NO_ANY('Active', 'Deactivated')}
                  value={draft.is_active}
                  onChange={(is_active) => setDraft({ ...draft, is_active })}
                />
                <OptionChips
                  label="Visibility"
                  options={YES_NO_ANY('Public', 'Private')}
                  value={draft.is_public}
                  onChange={(is_public) => setDraft({ ...draft, is_public })}
                />
              </FieldGrid>
              <View style={styles.actions}>
                <Button title="Apply filters" onPress={apply} />
                <Button title="Clear" variant="secondary" onPress={clear} />
              </View>
            </Card>
          ) : null}

          <FormError message={setActive.isError ? errorMessage(setActive.error) : null} />

          {offers.isPending ? (
            <LoadingState />
          ) : offers.isError ? (
            <ErrorState error={offers.error} onRetry={() => offers.refetch()} />
          ) : offers.data.results.length === 0 ? (
            <EmptyState message="No offers match these filters." />
          ) : (
            <>
              <Text style={styles.count}>
                {offers.data.count} offer{offers.data.count === 1 ? '' : 's'}
              </Text>
              <View style={asTable ? styles.table : styles.cards}>
                {asTable ? <TableHeader /> : null}
                {offers.data.results.map((offer) => (
                  <OfferRow
                    key={offer.id}
                    offer={offer}
                    wide={asTable}
                    selected={offer.id === selected}
                    toggling={setActive.isPending && setActive.variables?.id === offer.id}
                    onToggleActive={(is_active) => setActive.mutate({ id: offer.id, is_active })}
                    onEdit={() => navigation.setParams({ id: offer.id })}
                  />
                ))}
              </View>
              <Pagination page={page} count={offers.data.count} onChange={setPage} />
            </>
          )}
        </Screen>
      }
    />
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
  offer: AdminOffer;
  wide: boolean;
  selected: boolean;
  toggling: boolean;
  onToggleActive: (value: boolean) => void;
  onEdit: () => void;
};

function OfferRow({ offer, wide, selected, toggling, onToggleActive, onEdit }: RowProps) {
  const route = `${offer.origin.code} → ${offer.destination.code}`;
  const cities = `${offer.origin.city} → ${offer.destination.city}`;
  const flight = `${offer.airline} · ${ticketClassLabel(offer.ticket_class)} · ${stopoversLabel(offer.stopovers)}`;
  const status = [
    offer.is_public ? 'Public' : 'Private',
    offer.is_bookable ? 'Bookable' : offer.is_active ? 'Lapsed' : 'Deactivated',
  ].join(' · ');
  const toggle = (
    <Toggle
      label={offer.is_active ? 'Active' : 'Inactive'}
      value={offer.is_active}
      onChange={onToggleActive}
      disabled={toggling}
    />
  );

  if (wide) {
    return (
      <View style={[styles.tableRow, selected && styles.selected]} aria-current={selected}>
        <View style={styles.colRoute}>
          <Text style={styles.strong}>{route}</Text>
          <Text style={styles.muted}>{cities}</Text>
        </View>
        <View style={styles.colDates}>
          <Text style={styles.cell}>{formatDate(offer.departure_date)}</Text>
          <Text style={styles.muted}>until {formatDate(offer.valid_until)}</Text>
        </View>
        <Text style={[styles.cell, styles.colFlight]}>{flight}</Text>
        <Text style={[styles.strong, styles.colPrice]}>{formatPrice(offer.price)}</Text>
        <Text style={[styles.cell, styles.colStatus]}>{status}</Text>
        <View style={[styles.colActions, styles.rowActions]}>
          {toggle}
          <Button title="Edit" variant="link" onPress={onEdit} />
        </View>
      </View>
    );
  }

  return (
    <Card selected={selected}>
      <View style={styles.cardTop}>
        <View style={styles.shrink}>
          <Text style={styles.strong}>{route}</Text>
          <Text style={styles.muted}>{cities}</Text>
        </View>
        <Text style={styles.strong}>{formatPrice(offer.price)}</Text>
      </View>
      <Text style={styles.cell}>
        {formatDate(offer.departure_date)} · valid until {formatDate(offer.valid_until)}
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
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    ...shadow,
  },
  tableHeader: { backgroundColor: colors.background },
  selected: { backgroundColor: colors.primaryTint },
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
