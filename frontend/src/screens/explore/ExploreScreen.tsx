import { useNavigation } from '@react-navigation/native';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { Offer, Paginated } from '../../api/types';
import { useAuthGate } from '../../auth/gate';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { OptionChips } from '../../components/OptionChips';
import {
  EMPTY_OFFER_FILTERS,
  OfferFilterErrors,
  OfferFilterFields,
  OfferFilterValues,
  offerFilterParams,
  validateOfferFilters,
} from '../../components/OfferFilterFields';
import { OfferCard } from '../../components/OfferCard';
import { Pagination } from '../../components/Pagination';
import { Screen } from '../../components/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { QueryPrefill } from '../../navigation/types';
import { colors, useIsWide } from '../../theme';

type Ordering = 'departure_date' | 'price' | '-price';

/** The applied filters as a request for options; airports only when chosen from the suggestions. */
function queryPrefill(filters: OfferFilterValues): QueryPrefill {
  const prefill: QueryPrefill = {
    origin: filters.origin.airport?.code,
    destination: filters.destination.airport?.code,
    date_from: filters.date_from,
    date_to: filters.date_to,
    price_min: filters.price_min.trim(),
    price_max: filters.price_max.trim(),
    ticket_class: filters.ticket_class || undefined,
    max_stopovers: filters.max_stopovers.trim(),
  };
  return Object.fromEntries(Object.entries(prefill).filter(([, value]) => value)) as QueryPrefill;
}

const ORDERING_OPTIONS: { value: Ordering; label: string }[] = [
  { value: 'departure_date', label: 'Soonest departure' },
  { value: 'price', label: 'Lowest price' },
  { value: '-price', label: 'Highest price' },
];

export function ExploreScreen() {
  const navigation = useNavigation();
  const isWide = useIsWide();
  const [draft, setDraft] = useState<OfferFilterValues>(EMPTY_OFFER_FILTERS);
  const [errors, setErrors] = useState<OfferFilterErrors>({});
  const [filters, setFilters] = useState<OfferFilterValues>(EMPTY_OFFER_FILTERS);
  const [ordering, setOrdering] = useState<Ordering>('departure_date');
  const [page, setPage] = useState(1);
  const [moreFilters, setMoreFilters] = useState(false);
  const requireAuth = useAuthGate();

  const offers = useQuery({
    queryKey: ['offers', filters, ordering, page],
    queryFn: async () => {
      const params = { ...offerFilterParams(filters), ordering, page };
      return (await api.get<Paginated<Offer>>('/offers', { params })).data;
    },
    placeholderData: keepPreviousData,
  });

  const search = () => {
    const found = validateOfferFilters(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setMoreFilters(true);
      return;
    }
    setFilters(draft);
    setPage(1);
  };

  const clear = () => {
    setDraft(EMPTY_OFFER_FILTERS);
    setErrors({});
    setFilters(EMPTY_OFFER_FILTERS);
    setPage(1);
  };

  return (
    <Screen>
      <Text style={styles.title}>Find a flight deal</Text>
      <Card>
        <OfferFilterFields
          value={draft}
          onChange={setDraft}
          errors={errors}
          onSubmit={search}
          showDetails={isWide || moreFilters}
        />
        <View style={styles.actions}>
          <Button title="Search" onPress={search} />
          <Button title="Clear" variant="secondary" onPress={clear} />
          {!isWide ? (
            <Button
              title={moreFilters ? 'Fewer filters' : 'More filters'}
              variant="link"
              onPress={() => setMoreFilters((open) => !open)}
            />
          ) : null}
        </View>
      </Card>

      <OptionChips
        label="Sort by"
        options={ORDERING_OPTIONS}
        value={ordering}
        onChange={(value) => {
          setOrdering(value);
          setPage(1);
        }}
      />

      {offers.isPending ? (
        <LoadingState />
      ) : offers.isError ? (
        <ErrorState error={offers.error} onRetry={() => offers.refetch()} />
      ) : offers.data.results.length === 0 ? (
        <View style={styles.empty}>
          <EmptyState message="No flight deals match your search right now. Tell us what you need and we will find options for you." />
          <Button
            title="Request options"
            onPress={() => requireAuth({ screen: 'QueryNew', params: queryPrefill(filters) })}
          />
        </View>
      ) : (
        <>
          <Text style={styles.count}>
            {offers.data.count} deal{offers.data.count === 1 ? '' : 's'}
          </Text>
          <View style={styles.grid}>
            {offers.data.results.map((offer) => (
              <View key={offer.id} style={styles.gridItem}>
                <OfferCard
                  offer={offer}
                  onPress={() => navigation.navigate('OfferDetail', { id: offer.id })}
                />
              </View>
            ))}
          </View>
          <Pagination page={page} count={offers.data.count} onChange={setPage} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  count: { color: colors.muted },
  empty: { alignItems: 'center', gap: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridItem: { flexGrow: 1, flexBasis: 300, minWidth: 0 },
});
