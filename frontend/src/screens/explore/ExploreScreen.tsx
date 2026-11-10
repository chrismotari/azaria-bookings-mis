import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { Offer, Paginated } from '../../api/types';
import { useAuthGate } from '../../auth/gate';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DetailLayout } from '../../components/DetailLayout';
import { FlightRow } from '../../components/FlightRow';
import {
  EMPTY_OFFER_FILTERS,
  OfferFilterErrors,
  OfferFilterValues,
  offerFilterParams,
  validateOfferFilters,
} from '../../components/OfferFilterFields';
import { Pagination } from '../../components/Pagination';
import { SegmentedControl } from '../../components/SegmentedControl';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { MainTabParamList, QueryPrefill } from '../../navigation/types';
import { colors, font, radius, space, useIsWide } from '../../theme';
import { ExploreFilters } from './ExploreFilters';
import { ExploreSearchBar } from './ExploreSearchBar';
import { OfferDetailView } from './OfferDetailView';

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

/** The filters in the sidebar; the rest are in the search bar. */
const SIDEBAR_FIELDS = ['price_min', 'price_max', 'max_stopovers'] as const;

const ORDERING_OPTIONS: { value: Ordering; label: string }[] = [
  { value: 'departure_date', label: 'Soonest departure' },
  { value: 'price', label: 'Lowest price' },
  { value: '-price', label: 'Highest price' },
];

export function ExploreScreen({ navigation, route }: BottomTabScreenProps<MainTabParamList, 'Explore'>) {
  const selected = route.params?.id;
  const close = useCallback(() => navigation.setParams({ id: undefined, query: undefined }), [navigation]);
  // Beside an open detail the list column is too narrow for the sidebar and the one-row search bar.
  const compact = !useIsWide() || selected !== undefined;
  const [draft, setDraft] = useState<OfferFilterValues>(EMPTY_OFFER_FILTERS);
  const [errors, setErrors] = useState<OfferFilterErrors>({});
  const [filters, setFilters] = useState<OfferFilterValues>(EMPTY_OFFER_FILTERS);
  const [ordering, setOrdering] = useState<Ordering>('departure_date');
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
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
      if (SIDEBAR_FIELDS.some((name) => found[name])) {
        setFiltersOpen(true);
      }
      return;
    }
    setFilters(draft);
    setPage(1);
  };

  const applySidebar = (next: OfferFilterValues) => {
    const found = validateOfferFilters(next);
    setErrors(found);
    if (SIDEBAR_FIELDS.some((name) => found[name]) || SIDEBAR_FIELDS.every((name) => next[name] === filters[name])) {
      return;
    }
    setFilters({ ...filters, price_min: next.price_min, price_max: next.price_max, max_stopovers: next.max_stopovers });
    setPage(1);
  };

  const clearSidebar = () => {
    const cleared = { price_min: '', price_max: '', max_stopovers: '' };
    setDraft({ ...draft, ...cleared });
    setErrors({ ...errors, price_min: undefined, price_max: undefined, max_stopovers: undefined });
    setFilters({ ...filters, ...cleared });
    setPage(1);
  };

  const activeFilters = SIDEBAR_FIELDS.filter((name) => filters[name]).length;
  const sidebar = (
    <ExploreFilters value={draft} onChange={setDraft} errors={errors} onApply={applySidebar} onClear={clearSidebar} />
  );
  const sort = (
    <SegmentedControl
      label="Sort by"
      options={ORDERING_OPTIONS}
      value={ordering}
      onChange={(value) => {
        setOrdering(value);
        setPage(1);
      }}
    />
  );
  const count = offers.data ? (
    <Text style={styles.count}>
      {offers.data.count} deal{offers.data.count === 1 ? '' : 's'}
    </Text>
  ) : null;

  return (
    <DetailLayout
      title="Flight deal"
      backLabel="All deals"
      onClose={close}
      detail={selected ? <OfferDetailView key={selected} id={selected} query={route.params?.query} /> : null}
      list={
        <ScrollView style={styles.scroll}>
          <ExploreSearchBar value={draft} onChange={setDraft} errors={errors} onSearch={search} compact={compact} />
          <View style={[styles.body, !compact && styles.columns]}>
            {!compact ? (
              <View style={styles.sidebar}>
                <Card>{sidebar}</Card>
              </View>
            ) : null}
            <View style={styles.results}>
              <Card>
                {compact ? (
                  <>
                    <View style={styles.toolbar}>
                      <Button
                        title={activeFilters > 0 ? `Filters (${activeFilters})` : 'Filters'}
                        icon="options-outline"
                        variant="secondary"
                        onPress={() => setFiltersOpen((open) => !open)}
                      />
                      {count}
                    </View>
                    {filtersOpen ? <View style={styles.panel}>{sidebar}</View> : null}
                    {sort}
                  </>
                ) : (
                  <View style={styles.toolbar}>
                    <View style={styles.sort}>{sort}</View>
                    {count}
                  </View>
                )}

                {offers.isPending ? (
                  <LoadingState />
                ) : offers.isError ? (
                  <ErrorState error={offers.error} onRetry={() => offers.refetch()} />
                ) : offers.data.results.length === 0 ? (
                  <EmptyState
                    icon="airplane-outline"
                    title="No deals found"
                    message="No flight deals match your search right now. Tell us what you need and we will find options for you."
                    action={{
                      title: 'Request options',
                      onPress: () => requireAuth({ screen: 'Main', params: { screen: 'QueryNew', params: queryPrefill(filters) } }),
                    }}
                  />
                ) : (
                  <>
                    <View style={styles.rows}>
                      {offers.data.results.map((offer) => (
                        <FlightRow
                          key={offer.id}
                          offer={offer}
                          compact={compact}
                          selected={offer.id === selected}
                          onPress={() => navigation.setParams({ id: offer.id, query: undefined })}
                        />
                      ))}
                    </View>
                    <Pagination page={page} count={offers.data.count} onChange={setPage} />
                  </>
                )}
              </Card>
            </View>
          </View>
        </ScrollView>
      }
    />
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  body: { width: '100%', maxWidth: 1100 + 2 * space.lg, alignSelf: 'center', padding: space.lg, gap: space.lg },
  columns: { flexDirection: 'row', alignItems: 'flex-start' },
  sidebar: { width: 260 },
  results: { flex: 1, minWidth: 0 },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  sort: { flex: 1, maxWidth: 480 },
  count: { fontSize: font.small, color: colors.muted },
  panel: { padding: space.lg, borderRadius: radius.md, backgroundColor: colors.background },
  rows: { gap: space.md },
});
