import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { GetAppFooter } from '../../agency/GetAppFooter';
import { useModules } from '../../agency/modules';
import { Tour } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CoverImage } from '../../components/CoverImage';
import { DateField } from '../../components/DateField';
import { CARD_IMAGE_HEIGHT, CardFact, CardPrice, ItemCard } from '../../components/ItemCard';
import { Pagination } from '../../components/Pagination';
import { SegmentedControl } from '../../components/SegmentedControl';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { TextField } from '../../components/TextField';
import { colors, createStyles, font, space, useIsWide, weight } from '../../theme';
import { slotsLeftLabel, tourDates } from '../../utils/tours';
import { EMPTY_TOUR_FILTERS, TourFilters, TourOrdering, useTourList } from '../explore/exploreLists';
import { FeaturedRow } from '../explore/Featured';

type Filters = TourFilters;
const EMPTY = EMPTY_TOUR_FILTERS;

const ORDERING_OPTIONS: { value: TourOrdering; label: string }[] = [
  { value: 'start_date', label: 'Soonest' },
  { value: 'from_price', label: 'Lowest price' },
];

const PRICE = /^\d+(\.\d{1,2})?$/;

function validate(filters: Filters): Partial<Filters> {
  const errors: Partial<Filters> = {};
  for (const name of ['price_min', 'price_max'] as const) {
    if (filters[name].trim() && !PRICE.test(filters[name].trim())) {
      errors[name] = 'Enter an amount, e.g. 500.';
    }
  }
  if (filters.date_from && filters.date_to && filters.date_to < filters.date_from) {
    errors.date_to = 'Pick a date after the first one.';
  }
  return errors;
}

/** Explore's Tours tab: listed tours as cards. */
export function ToursPage() {
  const navigation = useNavigation();
  const compact = !useIsWide();
  const { list, update, results: tours } = useTourList();
  const { filters, ordering, page } = list;
  const [draft, setDraft] = useState<Filters>(filters);
  const [errors, setErrors] = useState<Partial<Filters>>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [width, setWidth] = useState(0);
  const single = useModules().length === 1;

  const apply = (next: Filters = draft) => {
    const found = validate(next);
    setErrors(found);
    if (Object.keys(found).length === 0) {
      update({ filters: { ...next, search: next.search.trim() }, page: 1 });
    }
  };
  const clear = () => {
    setDraft(EMPTY);
    setErrors({});
    update({ filters: EMPTY, page: 1 });
  };

  const sidebar = (
    <View style={styles.filters}>
      <View style={styles.between}>
        <Text style={styles.heading}>Filters</Text>
        <Button title="Clear all" variant="link" onPress={clear} />
      </View>
      <Text style={styles.label}>Starts between</Text>
      <DateField
        label="From"
        accessibilityLabel="Starts from"
        value={draft.date_from}
        onChange={(date_from) => apply({ ...draft, date_from })}
        error={errors.date_from}
      />
      <DateField
        label="To"
        accessibilityLabel="Starts by"
        value={draft.date_to}
        onChange={(date_to) => apply({ ...draft, date_to })}
        error={errors.date_to}
      />
      <Text style={styles.label}>Price per person (USD)</Text>
      <View style={styles.prices}>
        {(['price_min', 'price_max'] as const).map((name) => (
          <View key={name} style={styles.price}>
            <TextField
              label={name === 'price_min' ? 'Min price (USD)' : 'Max price (USD)'}
              value={draft[name]}
              onChangeText={(text) => setDraft({ ...draft, [name]: text })}
              onSubmitEditing={() => apply()}
              onBlur={() => apply()}
              error={errors[name]}
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
  const active = ['date_from', 'date_to', 'price_min', 'price_max'].filter((name) => filters[name as keyof Filters]);

  return (
    <ScrollView style={styles.scroll}>
      <View style={styles.body}>
        <Card>
          <View style={styles.searchRow}>
            <View style={styles.searchField}>
              <TextField
                label="Search tours"
                placeholder="Destination or name, e.g. Maasai Mara"
                value={draft.search}
                onChangeText={(search) => setDraft({ ...draft, search })}
                onSubmitEditing={() => apply()}
                returnKeyType="search"
              />
            </View>
            <Button title="Search" variant="accent" icon="search" onPress={() => apply()} />
          </View>
        </Card>
        {single && JSON.stringify(filters) === JSON.stringify(EMPTY) ? <FeaturedRow module="tours" /> : null}
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
                  title={active.length ? `Filters (${active.length})` : 'Filters'}
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
                  onChange={(value) => update({ ordering: value, page: 1 })}
                />
              </View>
              {tours.data ? (
                <Text style={styles.count}>
                  {tours.data.count} tour{tours.data.count === 1 ? '' : 's'}
                </Text>
              ) : null}
            </View>
            {compact && filtersOpen ? <Card>{sidebar}</Card> : null}
            <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
              {tours.isPending ? (
                <LoadingState />
              ) : tours.isError ? (
                <ErrorState error={tours.error} onRetry={() => tours.refetch()} />
              ) : tours.data.results.length === 0 ? (
                <Card>
                  <EmptyState
                    icon="map-outline"
                    title="No tours right now"
                    message="No tours match your search. Try other dates or clear the filters."
                  />
                </Card>
              ) : (
                <View style={styles.grid}>
                  {tours.data.results.map((tour) => (
                    <View key={tour.id} style={cardWidth ? { width: cardWidth } : styles.full}>
                      <TourCard
                        tour={tour}
                        onPress={() => navigation.navigate('Main', { screen: 'TourDetail', params: { id: tour.id } })}
                      />
                    </View>
                  ))}
                </View>
              )}
            </View>
            {tours.data ? (
              <Pagination page={page} count={tours.data.count} onChange={(next) => update({ page: next })} />
            ) : null}
          </View>
        </View>
        <GetAppFooter />
      </View>
    </ScrollView>
  );
}

/** A tour in a list: cover, title, destination, dates and its from price. */
export function TourCard({ tour, onPress, selected }: { tour: Tour; onPress: () => void; selected?: boolean }) {
  return (
    <ItemCard
      accessibilityLabel={`${tour.title}, ${tour.destination}`}
      onPress={onPress}
      selected={selected}
      featured={tour.is_featured}
      rating={tour.rating}
      image={<CoverImage url={tour.photos[0]?.url} height={CARD_IMAGE_HEIGHT} />}
      title={tour.title}
      price={
        <View style={styles.between}>
          {tour.from_price ? <CardPrice before="From" amount={tour.from_price} after="per person" /> : null}
          {tour.not_bookable_reason === 'fully_booked' ? (
            <StatusChip label="Fully booked" tone="warning" />
          ) : tour.slots_left <= 5 ? (
            <StatusChip label={slotsLeftLabel(tour.slots_left)} tone="warning" />
          ) : null}
        </View>
      }
    >
      <CardFact icon="location-outline">{tour.destination}</CardFact>
      <CardFact icon="calendar-outline">{tourDates(tour)}</CardFact>
    </ItemCard>
  );
}

const styles = createStyles(() => ({
  scroll: { flex: 1, backgroundColor: colors.background },
  body: { width: '100%', maxWidth: 1100 + 2 * space.lg, alignSelf: 'center', padding: space.lg, gap: space.lg },
  searchRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, flexWrap: 'wrap' },
  searchField: { flexGrow: 1, flexBasis: 220 },
  main: { gap: space.lg },
  columns: { flexDirection: 'row', alignItems: 'flex-start' },
  sidebar: { width: 260 },
  results: { flex: 1, minWidth: 0, gap: space.md },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  sort: { flexGrow: 1, maxWidth: 360 },
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
