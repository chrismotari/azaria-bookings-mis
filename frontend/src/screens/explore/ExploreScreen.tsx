import { useNavigation } from '@react-navigation/native';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { Offering, Paginated } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { OptionChips } from '../../components/OptionChips';
import {
  EMPTY_OFFERING_FILTERS,
  OfferingFilterErrors,
  OfferingFilterFields,
  OfferingFilterValues,
  offeringFilterParams,
  validateOfferingFilters,
} from '../../components/OfferingFilterFields';
import { OfferingCard } from '../../components/OfferingCard';
import { Pagination } from '../../components/Pagination';
import { Screen } from '../../components/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { colors, useIsWide } from '../../theme';

type Ordering = 'departure_date' | 'price' | '-price';

const ORDERING_OPTIONS: { value: Ordering; label: string }[] = [
  { value: 'departure_date', label: 'Soonest departure' },
  { value: 'price', label: 'Lowest price' },
  { value: '-price', label: 'Highest price' },
];

export function ExploreScreen() {
  const navigation = useNavigation();
  const isWide = useIsWide();
  const [draft, setDraft] = useState<OfferingFilterValues>(EMPTY_OFFERING_FILTERS);
  const [errors, setErrors] = useState<OfferingFilterErrors>({});
  const [filters, setFilters] = useState<OfferingFilterValues>(EMPTY_OFFERING_FILTERS);
  const [ordering, setOrdering] = useState<Ordering>('departure_date');
  const [page, setPage] = useState(1);
  const [moreFilters, setMoreFilters] = useState(false);

  const offerings = useQuery({
    queryKey: ['offerings', filters, ordering, page],
    queryFn: async () => {
      const params = { ...offeringFilterParams(filters), ordering, page };
      return (await api.get<Paginated<Offering>>('/offerings', { params })).data;
    },
    placeholderData: keepPreviousData,
  });

  const search = () => {
    const found = validateOfferingFilters(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setMoreFilters(true);
      return;
    }
    setFilters(draft);
    setPage(1);
  };

  const clear = () => {
    setDraft(EMPTY_OFFERING_FILTERS);
    setErrors({});
    setFilters(EMPTY_OFFERING_FILTERS);
    setPage(1);
  };

  return (
    <Screen>
      <Text style={styles.title}>Find a flight deal</Text>
      <Card>
        <OfferingFilterFields
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

      {offerings.isPending ? (
        <LoadingState />
      ) : offerings.isError ? (
        <ErrorState error={offerings.error} onRetry={() => offerings.refetch()} />
      ) : offerings.data.results.length === 0 ? (
        <EmptyState message="No flight deals match your search right now." />
      ) : (
        <>
          <Text style={styles.count}>
            {offerings.data.count} deal{offerings.data.count === 1 ? '' : 's'}
          </Text>
          <View style={styles.grid}>
            {offerings.data.results.map((offering) => (
              <View key={offering.id} style={styles.gridItem}>
                <OfferingCard
                  offering={offering}
                  onPress={() => navigation.navigate('OfferingDetail', { id: offering.id })}
                />
              </View>
            ))}
          </View>
          <Pagination page={page} count={offerings.data.count} onChange={setPage} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  count: { color: colors.muted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridItem: { flexGrow: 1, flexBasis: 300, minWidth: 0 },
});
