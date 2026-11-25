import { useNavigation } from '@react-navigation/native';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';

import { GetAppFooter } from '../../agency/GetAppFooter';
import { api } from '../../api/client';
import { Paginated, Tour } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DateField } from '../../components/DateField';
import { Icon } from '../../components/Icon';
import { Pagination } from '../../components/Pagination';
import { PressState } from '../../components/pressState';
import { SegmentedControl } from '../../components/SegmentedControl';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { TextField } from '../../components/TextField';
import { colors, createStyles, font, radius, shadow, space, useIsWide, weight } from '../../theme';
import { formatPrice } from '../../utils/format';
import { slotsLeftLabel, tourDates } from '../../utils/tours';

type Filters = { search: string; date_from: string; date_to: string; price_min: string; price_max: string };
type Ordering = 'start_date' | 'from_price';

const EMPTY: Filters = { search: '', date_from: '', date_to: '', price_min: '', price_max: '' };

const ORDERING_OPTIONS: { value: Ordering; label: string }[] = [
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

/** Explore's Tours tab: bookable tours as cards. */
export function ToursPage() {
  const navigation = useNavigation();
  const compact = !useIsWide();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [errors, setErrors] = useState<Partial<Filters>>({});
  const [ordering, setOrdering] = useState<Ordering>('start_date');
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [width, setWidth] = useState(0);

  const tours = useQuery({
    queryKey: ['tours', filters, ordering, page],
    queryFn: async () => {
      const params = Object.fromEntries(
        Object.entries({ ...filters, ordering, page }).filter(([, value]) => String(value).trim()),
      );
      return (await api.get<Paginated<Tour>>('/tours', { params })).data;
    },
    placeholderData: keepPreviousData,
  });

  const apply = (next: Filters = draft) => {
    const found = validate(next);
    setErrors(found);
    if (Object.keys(found).length === 0) {
      setFilters({ ...next, search: next.search.trim() });
      setPage(1);
    }
  };
  const clear = () => {
    setDraft(EMPTY);
    setErrors({});
    setFilters(EMPTY);
    setPage(1);
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
                  onChange={(value) => {
                    setOrdering(value);
                    setPage(1);
                  }}
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
            {tours.data ? <Pagination page={page} count={tours.data.count} onChange={setPage} /> : null}
          </View>
        </View>
        <GetAppFooter />
      </View>
    </ScrollView>
  );
}

/** A cover photo, or a neutral placeholder with an icon. */
export function TourCover({ url, height }: { url: string | null | undefined; height: number }) {
  if (url) {
    return <Image source={{ uri: url }} style={[styles.cover, { height }]} resizeMode="cover" accessible={false} />;
  }
  return (
    <View style={[styles.cover, styles.placeholder, { height }]}>
      <Icon name="image-outline" size={32} color={colors.light} />
    </View>
  );
}

function TourCard({ tour, onPress }: { tour: Tour; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${tour.title}, ${tour.destination}`}
      onPress={onPress}
      style={({ hovered }: PressState) => [styles.card, hovered && styles.hovered]}
    >
      <TourCover url={tour.photos[0]?.url} height={170} />
      <View style={styles.cardBody}>
        <Text style={styles.title} numberOfLines={2}>
          {tour.title}
        </Text>
        <View style={styles.fact}>
          <Icon name="location-outline" size={16} color={colors.muted} />
          <Text style={styles.muted} numberOfLines={1}>
            {tour.destination}
          </Text>
        </View>
        <View style={styles.fact}>
          <Icon name="calendar-outline" size={16} color={colors.muted} />
          <Text style={styles.muted}>{tourDates(tour)}</Text>
        </View>
        <View style={styles.between}>
          {tour.from_price ? (
            <Text style={styles.from}>
              From <Text style={styles.priceText}>{formatPrice(tour.from_price)}</Text> per person
            </Text>
          ) : null}
          {tour.slots_left <= 5 ? <StatusChip label={slotsLeftLabel(tour.slots_left)} tone="warning" /> : null}
        </View>
      </View>
    </Pressable>
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow,
  },
  hovered: { borderColor: colors.primary },
  cover: { width: '100%', backgroundColor: colors.neutralTint },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: space.lg, gap: space.sm },
  title: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  muted: { fontSize: font.small, color: colors.muted, flexShrink: 1 },
  from: { fontSize: font.small, color: colors.text },
  priceText: { fontSize: font.heading, fontWeight: weight.heavy, color: colors.text },
}));
