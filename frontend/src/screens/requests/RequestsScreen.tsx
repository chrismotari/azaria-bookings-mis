import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { Paginated, Query } from '../../api/types';
import { Button } from '../../components/Button';
import { DetailLayout } from '../../components/DetailLayout';
import { Icon } from '../../components/Icon';
import { Pagination } from '../../components/Pagination';
import { RouteLine } from '../../components/RouteLine';
import { Screen } from '../../components/Screen';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { TripCard } from '../../components/TripCard';
import { MainTabParamList } from '../../navigation/types';
import { colors, font, space, weight } from '../../theme';
import { formatDateTime } from '../../utils/format';
import { QUERY_STATUS, describeQuery } from '../../utils/queries';
import { QueryDetailView } from './QueryDetailView';

export function RequestsScreen({ navigation, route }: BottomTabScreenProps<MainTabParamList, 'Requests'>) {
  const rootNavigation = useNavigation();
  const selected = route.params?.id;
  const close = useCallback(() => navigation.setParams({ id: undefined }), [navigation]);
  const [page, setPage] = useState(1);
  const queries = useQuery({
    queryKey: ['queries', page],
    queryFn: async () => (await api.get<Paginated<Query>>('/queries', { params: { page } })).data,
    placeholderData: keepPreviousData,
  });

  return (
    <DetailLayout
      title="Request"
      backLabel="All requests"
      onClose={close}
      detail={selected ? <QueryDetailView key={selected} id={selected} /> : null}
      list={
        <Screen maxWidth={900} card>
          <View style={styles.header}>
            <Text style={styles.title}>My requests</Text>
            <Button title="New request" onPress={() => rootNavigation.navigate('Main', { screen: 'QueryNew' })} />
          </View>
          {queries.isPending ? (
            <LoadingState />
          ) : queries.isError ? (
            <ErrorState error={queries.error} onRetry={() => queries.refetch()} />
          ) : queries.data.results.length === 0 ? (
            <EmptyState
              icon="chatbubbles-outline"
              title="No requests yet"
              message="You have not asked for any flight options yet."
            />
          ) : (
            <>
              <View style={styles.list}>
                {queries.data.results.map((query) => (
                  <QueryRow
                    key={query.id}
                    query={query}
                    selected={query.id === selected}
                    onPress={() => navigation.setParams({ id: query.id })}
                  />
                ))}
              </View>
              <Pagination page={page} count={queries.data.count} onChange={setPage} />
            </>
          )}
        </Screen>
      }
    />
  );
}

function QueryRow({ query, selected, onPress }: { query: Query; selected: boolean; onPress: () => void }) {
  const details = describeQuery(query);
  const status = QUERY_STATUS[query.status];
  const criteria = [
    details.trip === 'Any' ? 'Any trip' : details.trip,
    details.ticketClass === 'Any' ? 'Any class' : details.ticketClass,
    details.prices === 'Any' ? 'Any price' : details.prices,
    query.max_stopovers === null
      ? 'Any stopovers'
      : query.max_stopovers === 0
        ? 'Direct only'
        : `Max ${query.max_stopovers} stopover${query.max_stopovers === 1 ? '' : 's'}`,
  ].join(' · ');
  return (
    <TripCard
      tone={status.tone}
      selected={selected}
      onPress={onPress}
      accessibilityLabel={`${details.route}, ${status.label}`}
    >
      <View style={styles.between}>
        <Text style={styles.muted}>Sent {formatDateTime(query.created_at)}</Text>
        <StatusChip label={status.label} tone={status.tone} />
      </View>
      <RouteLine origin={query.origin} destination={query.destination} returnTrip={query.trip_type === 'return'} />
      <View style={styles.fact}>
        <Icon name="calendar-outline" size={16} color={colors.muted} />
        <Text style={styles.text}>{details.dates}</Text>
      </View>
      <View style={styles.fact}>
        <Icon name="options-outline" size={16} color={colors.muted} />
        <Text style={styles.text}>{criteria}</Text>
      </View>
    </TripCard>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  list: { gap: space.md },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.sm },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  text: { fontSize: font.body, color: colors.text, flexShrink: 1 },
  muted: { color: colors.muted, fontSize: font.small },
});
