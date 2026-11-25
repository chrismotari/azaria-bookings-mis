import { useNavigation } from '@react-navigation/native';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { GetAppFooter } from '../../agency/GetAppFooter';
import { useModules } from '../../agency/modules';
import { api } from '../../api/client';
import { Hotel, Paginated } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Pagination } from '../../components/Pagination';
import { SegmentedControl } from '../../components/SegmentedControl';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { TextField } from '../../components/TextField';
import { colors, createStyles, font, space, useIsWide, weight } from '../../theme';
import { nightsBetween } from '../../utils/hotels';
import { FeaturedRow } from '../explore/Featured';
import { EMPTY_STAY, HotelCard, Stay, StayErrors, StayFields, stayParams, validateStay } from './HotelParts';

type Filters = { stars: string; price_min: string; price_max: string };
type Ordering = 'from_price' | '-star_rating' | 'name';

const EMPTY_FILTERS: Filters = { stars: '', price_min: '', price_max: '' };

const ORDERING_OPTIONS: { value: Ordering; label: string }[] = [
  { value: 'from_price', label: 'Lowest price' },
  { value: '-star_rating', label: 'Stars' },
  { value: 'name', label: 'Name' },
];

const STARS: { value: string; label: string }[] = [
  { value: '', label: 'Any' },
  { value: '3', label: '3+' },
  { value: '4', label: '4+' },
  { value: '5', label: '5' },
];

const PRICE = /^\d+(\.\d{1,2})?$/;

/** Explore's Hotels tab: hotels as cards, priced for the stay once dates are chosen. */
export function HotelsPage() {
  const navigation = useNavigation();
  const compact = !useIsWide();
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Stay>(EMPTY_STAY);
  const [stayErrors, setStayErrors] = useState<StayErrors>({});
  const [applied, setApplied] = useState<{ search: string; stay: Stay }>({ search: '', stay: EMPTY_STAY });
  const [filterDraft, setFilterDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [priceErrors, setPriceErrors] = useState<Partial<Filters>>({});
  const [ordering, setOrdering] = useState<Ordering>('from_price');
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [width, setWidth] = useState(0);

  const params = stayParams(applied.stay);
  const hotels = useQuery({
    queryKey: ['hotels', applied, filters, ordering, page],
    queryFn: async () => {
      const query = Object.fromEntries(
        Object.entries({ search: applied.search, ...params, ...filters, ordering, page }).filter(([, value]) =>
          String(value ?? '').trim(),
        ),
      );
      return (await api.get<Paginated<Hotel>>('/hotels', { params: query })).data;
    },
    placeholderData: keepPreviousData,
  });

  const runSearch = () => {
    const found = validateStay(draft);
    setStayErrors(found);
    if (Object.keys(found).length === 0) {
      setApplied({ search: search.trim(), stay: draft });
      setPage(1);
    }
  };
  const applyFilters = (next: Filters = filterDraft) => {
    const found: Partial<Filters> = {};
    for (const name of ['price_min', 'price_max'] as const) {
      if (next[name].trim() && !PRICE.test(next[name].trim())) {
        found[name] = 'Enter an amount, e.g. 150.';
      }
    }
    setPriceErrors(found);
    if (Object.keys(found).length === 0) {
      setFilters({ ...next, price_min: next.price_min.trim(), price_max: next.price_max.trim() });
      setPage(1);
    }
  };
  const clearFilters = () => {
    setFilterDraft(EMPTY_FILTERS);
    setPriceErrors({});
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const nights = params.check_in ? nightsBetween(params.check_in, params.check_out ?? '') : 0;
  const sidebar = (
    <View style={styles.filters}>
      <View style={styles.between}>
        <Text style={styles.heading}>Filters</Text>
        <Button title="Clear all" variant="link" onPress={clearFilters} />
      </View>
      <Text style={styles.label}>Stars</Text>
      <SegmentedControl
        label="Minimum stars"
        options={STARS}
        value={filterDraft.stars}
        onChange={(stars) => {
          setFilterDraft({ ...filterDraft, stars });
          applyFilters({ ...filterDraft, stars });
        }}
      />
      <Text style={styles.label}>{nights ? 'Price for the stay (USD)' : 'Price per night (USD)'}</Text>
      <View style={styles.prices}>
        {(['price_min', 'price_max'] as const).map((name) => (
          <View key={name} style={styles.price}>
            <TextField
              label={name === 'price_min' ? 'Min price (USD)' : 'Max price (USD)'}
              value={filterDraft[name]}
              onChangeText={(text) => setFilterDraft({ ...filterDraft, [name]: text })}
              onSubmitEditing={() => applyFilters()}
              onBlur={() => applyFilters()}
              error={priceErrors[name]}
              keyboardType="decimal-pad"
              placeholder={name === 'price_min' ? '0' : 'Any'}
            />
          </View>
        ))}
      </View>
    </View>
  );

  const columns = width >= 840 ? 3 : width >= 520 ? 2 : 1;
  const cardWidth = columns > 1 ? (width - space.lg * (columns - 1)) / columns : undefined;
  const active = Object.values(filters).filter(Boolean).length;
  const single = useModules().length === 1;
  const searching = Boolean(applied.search || Object.keys(params).length || active);

  return (
    <ScrollView style={styles.scroll}>
      <View style={styles.body}>
        <Card>
          <TextField
            label="Destination or hotel"
            placeholder="e.g. Diani Beach"
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={runSearch}
            returnKeyType="search"
          />
          <StayFields value={draft} onChange={setDraft} errors={stayErrors} />
          <View style={styles.searchButton}>
            <Button title="Search" variant="accent" icon="search" onPress={runSearch} />
          </View>
        </Card>
        {single && !searching ? <FeaturedRow module="hotels" /> : null}
        <View style={[styles.main, !compact && styles.columns]}>
          {!compact ? (
            <View style={styles.sidebar}>
              <Card>{sidebar}</Card>
            </View>
          ) : null}
          <View style={styles.results}>
            <View style={styles.toolbar}>
              {compact ? (
                <Button
                  title={active ? `Filters (${active})` : 'Filters'}
                  icon="options-outline"
                  variant="secondary"
                  onPress={() => setFiltersOpen((open) => !open)}
                />
              ) : null}
              <View style={styles.sort}>
                <SegmentedControl
                  label="Sort by"
                  options={ORDERING_OPTIONS}
                  value={ordering}
                  onChange={(value) => {
                    setOrdering(value);
                    setPage(1);
                  }}
                />
              </View>
              {hotels.data ? (
                <Text style={styles.count}>
                  {hotels.data.count} hotel{hotels.data.count === 1 ? '' : 's'}
                </Text>
              ) : null}
            </View>
            {compact && filtersOpen ? <Card>{sidebar}</Card> : null}
            <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
              {hotels.isPending ? (
                <LoadingState />
              ) : hotels.isError ? (
                <ErrorState error={hotels.error} onRetry={() => hotels.refetch()} />
              ) : hotels.data.results.length === 0 ? (
                <Card>
                  {searching ? (
                    <EmptyState
                      icon="bed-outline"
                      title="No hotels match"
                      message="Try other dates or guests, or clear the filters."
                    />
                  ) : (
                    <EmptyState icon="bed-outline" title="No hotels right now" message="Check back soon." />
                  )}
                </Card>
              ) : (
                <View style={styles.grid}>
                  {hotels.data.results.map((hotel) => (
                    <View key={hotel.id} style={cardWidth ? { width: cardWidth } : styles.full}>
                      <HotelCard
                        hotel={hotel}
                        nights={nights}
                        onPress={() =>
                          navigation.navigate('Main', { screen: 'HotelDetail', params: { id: hotel.id, ...params } })
                        }
                      />
                    </View>
                  ))}
                </View>
              )}
            </View>
            {hotels.data ? <Pagination page={page} count={hotels.data.count} onChange={setPage} /> : null}
          </View>
        </View>
        <GetAppFooter />
      </View>
    </ScrollView>
  );
}

const styles = createStyles(() => ({
  scroll: { flex: 1, backgroundColor: colors.background },
  body: { width: '100%', maxWidth: 1100 + 2 * space.lg, alignSelf: 'center', padding: space.lg, gap: space.lg },
  searchButton: { alignSelf: 'flex-start' },
  main: { gap: space.lg },
  columns: { flexDirection: 'row', alignItems: 'flex-start' },
  sidebar: { width: 260 },
  results: { flex: 1, minWidth: 0, gap: space.md },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  sort: { flexGrow: 1, maxWidth: 400 },
  count: { fontSize: font.small, color: colors.muted },
  filters: { gap: space.md },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  heading: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  label: { fontSize: font.small, fontWeight: weight.bold, color: colors.text },
  prices: { flexDirection: 'row', gap: space.sm },
  price: { flex: 1, minWidth: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  full: { width: '100%' },
}));
