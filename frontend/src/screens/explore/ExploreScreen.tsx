import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { api } from '../../api/client';
import { OfferList } from '../../api/types';
import { useAuthGate } from '../../auth/gate';
import { Card } from '../../components/Card';
import { FlightRow } from '../../components/FlightRow';
import {
  EMPTY_OFFER_FILTERS,
  OfferFilterErrors,
  OfferFilterValues,
  offerFilterParams,
  validateOfferFilters,
} from '../../components/OfferFilterFields';
import { ModulePages } from '../../components/ModulePages';
import { useModules } from '../../agency/modules';
import { Pagination } from '../../components/Pagination';
import { FlightServiceRating } from '../../components/Reviews';
import { SegmentedControl } from '../../components/SegmentedControl';
import { ColumnResults, SplitView } from '../../components/SplitView';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { MainTabParamList, QueryPrefill } from '../../navigation/types';
import { createStyles, space, useIsWide } from '../../theme';
import { routeCodes } from '../../utils/format';
import { ExploreFilters } from './ExploreFilters';
import { ExploreSearchBar } from './ExploreSearchBar';
import { ExploreTab } from './ExploreTab';
import { HotelsPage } from '../hotels/HotelsPage';
import { ToursPage } from '../tours/ToursPage';
import { ExploreAll } from './ExploreAll';
import { FeaturedRow } from './Featured';
import { OfferDetailView, useOffer } from './OfferDetailView';

type Ordering = 'departure_date' | 'price' | '-price';

/** The applied filters as a request for options; airports only when chosen from the suggestions. */
function queryPrefill(filters: OfferFilterValues): QueryPrefill {
  const prefill: QueryPrefill = {
    origin: filters.origin.airport?.code,
    destination: filters.destination.airport?.code,
    date_from: filters.date_from,
    date_to: filters.date_to,
    trip_type: filters.trip_type || undefined,
    return_date: filters.trip_type === 'return' ? filters.return_from : undefined,
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

type Props = BottomTabScreenProps<MainTabParamList, 'Explore'>;

export function ExploreScreen(props: Props) {
  const { navigation, route } = props;
  return (
    <ModulePages
      label="Explore"
      all={() => <ExploreAll onOpen={(tab) => navigation.setParams({ tab })} />}
      tab={route.params?.id ? 'flights' : route.params?.tab}
      hideSwitch={Boolean(route.params?.id)}
      onTab={(tab) => navigation.setParams({ tab })}
      pages={{
        flights: () => <FlightDeals {...props} />,
        tours: () => <ToursPage />,
        hotels: () => <HotelsPage />,
      }}
    />
  );
}

function FlightDeals({ navigation, route }: Props) {
  const selected = route.params?.id;
  const single = useModules().length === 1;
  const close = useCallback(
    () => navigation.setParams({ id: undefined, query: undefined, ...(single ? {} : { tab: 'flights' as const }) }),
    [navigation, single],
  );
  const offer = useOffer(selected);
  const compact = !useIsWide();
  const [draft, setDraft] = useState<OfferFilterValues>(EMPTY_OFFER_FILTERS);
  const [errors, setErrors] = useState<OfferFilterErrors>({});
  const [filters, setFilters] = useState<OfferFilterValues>(EMPTY_OFFER_FILTERS);
  const [ordering, setOrdering] = useState<Ordering>('departure_date');
  const [page, setPage] = useState(1);
  const requireAuth = useAuthGate();

  const offers = useQuery({
    queryKey: ['offers', filters, ordering, page],
    queryFn: async () => {
      const params = { ...offerFilterParams(filters), ordering, page };
      return (await api.get<OfferList>('/offers', { params })).data;
    },
    placeholderData: keepPreviousData,
  });

  const search = () => {
    const found = validateOfferFilters(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) {
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

  return (
    <SplitView
      open={Boolean(selected)}
      title={
        offer.data
          ? routeCodes(offer.data.origin, offer.data.destination, offer.data.trip_type === 'return')
          : 'Flight deal'
      }
      backLabel="All deals"
      onClose={close}
      column={
        <ColumnResults
          query={offers}
          render={(item) => (
            <FlightRow
              key={item.id}
              offer={item}
              compact
              selected={item.id === selected}
              onPress={() => navigation.setParams({ id: item.id, query: undefined })}
            />
          )}
        />
      }
      page={page}
      count={offers.data?.count}
      onPage={setPage}
      detail={selected ? <OfferDetailView key={selected} id={selected} query={route.params?.query} /> : null}
      list={
        <ExploreTab
          band={
            <ExploreSearchBar value={draft} onChange={setDraft} errors={errors} onSearch={search} compact={compact} />
          }
          featured={
            single && JSON.stringify(filters) === JSON.stringify(EMPTY_OFFER_FILTERS) ? (
              <FeaturedRow module="flights" />
            ) : null
          }
          filters={
            <ExploreFilters
              value={draft}
              onChange={setDraft}
              errors={errors}
              onApply={applySidebar}
              onClear={clearSidebar}
            />
          }
          activeFilters={activeFilters}
          filtersInvalid={SIDEBAR_FIELDS.some((name) => errors[name])}
          sort={
            <SegmentedControl
              label="Sort by"
              options={ORDERING_OPTIONS}
              value={ordering}
              onChange={(value) => {
                setOrdering(value);
                setPage(1);
              }}
            />
          }
          count={offers.data ? `${offers.data.count} deal${offers.data.count === 1 ? '' : 's'}` : null}
        >
          <Card>
            <FlightServiceRating rating={offers.data?.service_rating} />
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
                  onPress: () =>
                    requireAuth({ screen: 'Main', params: { screen: 'QueryNew', params: queryPrefill(filters) } }),
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
        </ExploreTab>
      }
    />
  );
}

const styles = createStyles(() => ({
  rows: { gap: space.md },
}));
