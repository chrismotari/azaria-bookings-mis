import { useNavigation } from '@react-navigation/native';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { Paginated, Query } from '../../api/types';
import { Button } from '../../components/Button';
import { Pagination } from '../../components/Pagination';
import { Screen } from '../../components/Screen';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { colors, radius, shadow } from '../../theme';
import { formatDateTime } from '../../utils/format';
import { QUERY_STATUS, describeQuery } from '../../utils/queries';

export function RequestsScreen() {
  const navigation = useNavigation();
  const [page, setPage] = useState(1);
  const queries = useQuery({
    queryKey: ['queries', page],
    queryFn: async () => (await api.get<Paginated<Query>>('/queries', { params: { page } })).data,
    placeholderData: keepPreviousData,
  });

  return (
    <Screen maxWidth={900}>
      <View style={styles.header}>
        <Text style={styles.title}>My requests</Text>
        <Button title="New request" onPress={() => navigation.navigate('QueryNew')} />
      </View>
      {queries.isPending ? (
        <LoadingState />
      ) : queries.isError ? (
        <ErrorState error={queries.error} onRetry={() => queries.refetch()} />
      ) : queries.data.results.length === 0 ? (
        <EmptyState message="You have not asked for any flight options yet." />
      ) : (
        <>
          <View style={styles.list}>
            {queries.data.results.map((query) => (
              <QueryRow
                key={query.id}
                query={query}
                onPress={() => navigation.navigate('QueryDetail', { id: query.id })}
              />
            ))}
          </View>
          <Pagination page={page} count={queries.data.count} onChange={setPage} />
        </>
      )}
    </Screen>
  );
}

function QueryRow({ query, onPress }: { query: Query; onPress: () => void }) {
  const details = describeQuery(query);
  const status = QUERY_STATUS[query.status];
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.rowMain}>
        <Text style={styles.route}>{details.route}</Text>
        <Text style={styles.text}>{details.dates}</Text>
        <Text style={styles.muted}>Sent {formatDateTime(query.created_at)}</Text>
      </View>
      <StatusChip label={status.label} tone={status.tone} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  list: { gap: 12 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    ...shadow,
  },
  pressed: { borderColor: colors.primary },
  rowMain: { flexShrink: 1, gap: 2 },
  route: { fontSize: 16, fontWeight: '700', color: colors.text },
  text: { color: colors.text },
  muted: { color: colors.muted, fontSize: 13 },
});
