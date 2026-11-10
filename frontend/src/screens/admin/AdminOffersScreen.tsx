import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { AdminOffer, Paginated } from '../../api/types';
import { AirlineBadge } from '../../components/AirlineBadge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DetailLayout } from '../../components/DetailLayout';
import { Field, FieldGrid, FormError } from '../../components/Field';
import {
  EMPTY_OFFER_FILTERS,
  OfferFilterErrors,
  OfferFilterFields,
  OfferFilterValues,
  offerFilterParams,
  validateOfferFilters,
} from '../../components/OfferFilterFields';
import { Pagination } from '../../components/Pagination';
import { PriceTag } from '../../components/PriceTag';
import { Screen } from '../../components/Screen';
import { SegmentedControl } from '../../components/SegmentedControl';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { Column, RouteCell, Table, TableRow, TwoLineCell } from '../../components/Table';
import { Toggle } from '../../components/Toggle';
import { AdminTabParamList } from '../../navigation/types';
import { colors, font, space, useIsWide, weight } from '../../theme';
import { formatDate, stopsLabel, ticketClassLabel } from '../../utils/format';
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
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
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

  const rows = offers.data?.results.map((offer) => (
    <OfferRow
      key={offer.id}
      offer={offer}
      wide={asTable}
      selected={offer.id === selected}
      toggling={setActive.isPending && setActive.variables?.id === offer.id}
      onToggleActive={(is_active) => setActive.mutate({ id: offer.id, is_active })}
      onEdit={() => navigation.setParams({ id: offer.id })}
    />
  ));

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
        <Screen card>
          <View style={styles.header}>
            <Text style={styles.title}>Offers</Text>
            <Button title="New offer" onPress={() => rootNavigation.navigate('AdminTabs', { screen: 'AdminOfferNew' })} />
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
                <Field label="Active">
                  <SegmentedControl
                    label="Active"
                    options={YES_NO_ANY('Active', 'Deactivated')}
                    value={draft.is_active}
                    onChange={(is_active) => setDraft({ ...draft, is_active })}
                  />
                </Field>
                <Field label="Visibility">
                  <SegmentedControl
                    label="Visibility"
                    options={YES_NO_ANY('Public', 'Private')}
                    value={draft.is_public}
                    onChange={(is_public) => setDraft({ ...draft, is_public })}
                  />
                </Field>
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
            <EmptyState icon="search-outline" title="No offers found" message="No offers match these filters." />
          ) : (
            <>
              <Text style={styles.count}>
                {offers.data.count} offer{offers.data.count === 1 ? '' : 's'}
              </Text>
              {asTable ? <Table columns={COLUMNS}>{rows}</Table> : <View style={styles.cards}>{rows}</View>}
              <Pagination page={page} count={offers.data.count} onChange={setPage} />
            </>
          )}
        </Screen>
      }
    />
  );
}

const COLUMNS: Column[] = [
  { label: 'Route', flex: 2 },
  { label: 'Departure / valid until', flex: 2 },
  { label: 'Flight', flex: 2.6 },
  { label: 'Price', flex: 1.4 },
  { label: 'Status', flex: 2 },
  { label: 'Active', flex: 2.2 },
];

type RowProps = {
  offer: AdminOffer;
  wide: boolean;
  selected: boolean;
  toggling: boolean;
  onToggleActive: (value: boolean) => void;
  onEdit: () => void;
};

function OfferRow({ offer, wide, selected, toggling, onToggleActive, onEdit }: RowProps) {
  const flight = `${ticketClassLabel(offer.ticket_class)} · ${stopsLabel(offer.stop_count)}`;
  const chips = (
    <View style={styles.chips}>
      <StatusChip label={offer.is_public ? 'Public' : 'Private'} tone={offer.is_public ? 'info' : 'neutral'} />
      <StatusChip
        label={offer.is_bookable ? 'Bookable' : offer.is_active ? 'Lapsed' : 'Deactivated'}
        tone={offer.is_bookable ? 'success' : offer.is_active ? 'warning' : 'neutral'}
      />
    </View>
  );
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
      <TableRow
        columns={COLUMNS}
        selected={selected}
        cells={[
          <RouteCell key="route" origin={offer.origin} destination={offer.destination} />,
          <TwoLineCell
            key="dates"
            primary={formatDate(offer.departure_date)}
            secondary={`until ${formatDate(offer.valid_until)}`}
          />,
          <View key="flight" style={styles.airlineCell}>
            <AirlineBadge airline={offer.airline} size={32} />
            <View style={styles.shrink}>
              <TwoLineCell primary={offer.airline.name} secondary={flight} />
            </View>
          </View>,
          <PriceTag key="price" amount={offer.price} />,
          chips,
          <View key="actions" style={styles.rowActions}>
            {toggle}
            <Button title="Edit" variant="link" onPress={onEdit} />
          </View>,
        ]}
      />
    );
  }

  return (
    <Card selected={selected}>
      <View style={styles.cardTop}>
        <RouteCell origin={offer.origin} destination={offer.destination} />
        <PriceTag amount={offer.price} />
      </View>
      <Text style={styles.cell}>
        {formatDate(offer.departure_date)} · valid until {formatDate(offer.valid_until)}
      </Text>
      <View style={styles.airlineCell}>
        <AirlineBadge airline={offer.airline} size={32} />
        <Text style={[styles.cell, styles.shrink]}>
          {offer.airline.name} · {flight}
        </Text>
      </View>
      {chips}
      <View style={styles.cardTop}>
        {toggle}
        <Button title="Edit" variant="secondary" onPress={onEdit} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  actions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  count: { color: colors.muted },
  cards: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  rowActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' },
  cell: { color: colors.text },
  airlineCell: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  shrink: { flexShrink: 1, minWidth: 0 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
});
