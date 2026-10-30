import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { AdminQuery, Paginated, QueryStatus } from '../../api/types';
import { DetailLayout } from '../../components/DetailLayout';
import { OptionChips } from '../../components/OptionChips';
import { Pagination } from '../../components/Pagination';
import { Screen } from '../../components/Screen';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { AdminTabParamList } from '../../navigation/types';
import { colors, radius, shadow } from '../../theme';
import { formatDateTime } from '../../utils/format';
import { QUERY_STATUS, describeQuery } from '../../utils/queries';
import { AdminQueryDetailView } from './AdminQueryDetailView';

const STATUS_OPTIONS: { value: QueryStatus | 'all'; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'responded', label: 'Responded' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
];

export function AdminRequestsScreen({ navigation, route }: BottomTabScreenProps<AdminTabParamList, 'AdminRequests'>) {
  const selected = route.params?.id;
  const close = useCallback(() => navigation.setParams({ id: undefined }), [navigation]);
  const status = route.params?.status ?? 'open';
  const [page, setPage] = useState(1);
  const queries = useQuery({
    queryKey: ['admin', 'queries', status, page],
    queryFn: async () => {
      const params = { page, ...(status === 'all' ? {} : { status }) };
      return (await api.get<Paginated<AdminQuery>>('/admin/queries', { params })).data;
    },
    placeholderData: keepPreviousData,
  });

  return (
    <DetailLayout
      title="Request"
      backLabel="All requests"
      onClose={close}
      detail={selected ? <AdminQueryDetailView key={selected} id={selected} /> : null}
      list={
        <Screen>
          <Text style={styles.title}>Requests</Text>
          <OptionChips
            label="Status"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(value) => {
              setPage(1);
              navigation.setParams({ status: value });
            }}
          />
          {queries.isPending ? (
            <LoadingState />
          ) : queries.isError ? (
            <ErrorState error={queries.error} onRetry={() => queries.refetch()} />
          ) : queries.data.results.length === 0 ? (
            <EmptyState message="No requests here." />
          ) : (
            <>
              <View style={styles.grid}>
                {queries.data.results.map((query) => (
                  <View key={query.id} style={styles.gridItem}>
                    <AdminQueryCard
                      query={query}
                      selected={query.id === selected}
                      onPress={() => navigation.setParams({ id: query.id })}
                    />
                  </View>
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

function AdminQueryCard({ query, selected, onPress }: { query: AdminQuery; selected: boolean; onPress: () => void }) {
  const details = describeQuery(query);
  const status = QUERY_STATUS[query.status];
  return (
    <Pressable
      accessibilityRole="link"
      aria-current={selected}
      onPress={onPress}
      style={({ pressed }) => [styles.card, (pressed || selected) && styles.pressed, selected && styles.selected]}
    >
      <View style={styles.cardTop}>
        <Text style={styles.customer} numberOfLines={1}>
          {query.user.full_name}
        </Text>
        <StatusChip label={status.label} tone={status.tone} />
      </View>
      <Text style={styles.route}>{details.route}</Text>
      <Text style={styles.text}>
        {details.dates} · {details.ticketClass} · {details.prices}
      </Text>
      <Text style={styles.muted}>Received {formatDateTime(query.created_at)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridItem: { flexGrow: 1, flexBasis: 340, minWidth: 0 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 4,
    ...shadow,
  },
  pressed: { borderColor: colors.primary },
  selected: { backgroundColor: colors.primaryTint },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  customer: { flexShrink: 1, color: colors.muted, fontWeight: '600' },
  route: { fontSize: 16, fontWeight: '700', color: colors.text },
  text: { color: colors.text },
  muted: { color: colors.muted, fontSize: 13 },
});
