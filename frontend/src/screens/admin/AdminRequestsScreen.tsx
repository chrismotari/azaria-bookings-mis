import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { AdminQuery, Paginated, QueryStatus } from '../../api/types';
import { DetailLayout } from '../../components/DetailLayout';
import { Icon } from '../../components/Icon';
import { Pagination } from '../../components/Pagination';
import { RouteLine } from '../../components/RouteLine';
import { Screen } from '../../components/Screen';
import { SegmentedControl } from '../../components/SegmentedControl';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { Column, RouteCell, Table, TableRow, TwoLineCell } from '../../components/Table';
import { TripCard } from '../../components/TripCard';
import { AdminTabParamList } from '../../navigation/types';
import { colors, font, space, useIsWide, weight } from '../../theme';
import { formatDateTime } from '../../utils/format';
import { QUERY_STATUS, describeQuery } from '../../utils/queries';
import { AdminQueryDetailView } from './AdminQueryDetailView';
import { useListPage, useMissingPageReset } from '../../utils/listPage';

const STATUS_OPTIONS: { value: QueryStatus | 'all'; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'responded', label: 'Responded' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
];

const COLUMNS: Column[] = [
  { label: 'Customer', flex: 2 },
  { label: 'Route', flex: 2 },
  { label: 'Dates', flex: 2.2 },
  { label: 'Criteria', flex: 2.2 },
  { label: 'Status', flex: 1.8 },
  { label: 'Received', flex: 1.6 },
];

/** Class and price, e.g. "Business · Up to $3,000.00". */
function criteria(query: AdminQuery): string {
  const details = describeQuery(query);
  return [
    details.ticketClass === 'Any' ? 'Any class' : details.ticketClass,
    details.prices === 'Any' ? 'Any price' : details.prices,
  ].join(' · ');
}

export function AdminRequestsScreen({ navigation, route }: BottomTabScreenProps<AdminTabParamList, 'AdminRequests'>) {
  const selected = route.params?.id;
  const close = useCallback(() => navigation.setParams({ id: undefined }), [navigation]);
  // With a request open the list is too narrow for the table.
  const asTable = useIsWide() && selected === undefined;
  const status = route.params?.status ?? 'open';
  const [page, setPage] = useListPage(status);
  const queries = useQuery({
    queryKey: ['admin', 'queries', status, page],
    queryFn: async () => {
      const params = { page, ...(status === 'all' ? {} : { status }) };
      return (await api.get<Paginated<AdminQuery>>('/admin/queries', { params })).data;
    },
    placeholderData: keepPreviousData,
  });
  useMissingPageReset(queries.error, page, setPage);
  const open = (query: AdminQuery) => navigation.setParams({ id: query.id });

  return (
    <DetailLayout
      title="Request"
      backLabel="All requests"
      onClose={close}
      detail={selected ? <AdminQueryDetailView key={selected} id={selected} /> : null}
      list={
        <Screen card>
          <Text style={styles.title}>Requests</Text>
          <SegmentedControl
            label="Status"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(value) => {
              setPage(1);
              navigation.setParams({ status: value });
            }}
            wrap
          />
          {queries.isPending ? (
            <LoadingState />
          ) : queries.isError ? (
            <ErrorState error={queries.error} onRetry={() => queries.refetch()} />
          ) : queries.data.results.length === 0 ? (
            <EmptyState icon="chatbubbles-outline" title="Nothing here" message="No requests here." />
          ) : (
            <>
              {asTable ? (
                <Table columns={COLUMNS}>
                  {queries.data.results.map((query) => (
                    <QueryTableRow key={query.id} query={query} onPress={() => open(query)} />
                  ))}
                </Table>
              ) : (
                <View style={styles.cards}>
                  {queries.data.results.map((query) => (
                    <AdminQueryCard
                      key={query.id}
                      query={query}
                      selected={query.id === selected}
                      onPress={() => open(query)}
                    />
                  ))}
                </View>
              )}
              <Pagination page={page} count={queries.data.count} onChange={setPage} />
            </>
          )}
        </Screen>
      }
    />
  );
}

function QueryTableRow({ query, onPress }: { query: AdminQuery; onPress: () => void }) {
  const status = QUERY_STATUS[query.status];
  const details = describeQuery(query);
  return (
    <TableRow
      columns={COLUMNS}
      onPress={onPress}
      accessibilityLabel={`${query.user.full_name}, ${details.route}, ${status.label}`}
      cells={[
        <TwoLineCell key="customer" primary={query.user.full_name} secondary={query.user.email} />,
        <RouteCell
          key="route"
          origin={query.origin}
          destination={query.destination}
          returnTrip={query.trip_type === 'return'}
        />,
        details.dates,
        <TwoLineCell
          key="criteria"
          primary={criteria(query)}
          secondary={details.maxStopovers === 'Any' ? undefined : `Max stopovers: ${details.maxStopovers}`}
        />,
        <StatusChip key="status" label={status.label} tone={status.tone} />,
        <Text key="received" style={styles.small}>
          {formatDateTime(query.created_at)}
        </Text>,
      ]}
    />
  );
}

function AdminQueryCard({ query, selected, onPress }: { query: AdminQuery; selected: boolean; onPress: () => void }) {
  const details = describeQuery(query);
  const status = QUERY_STATUS[query.status];
  return (
    <TripCard
      tone={status.tone}
      selected={selected}
      onPress={onPress}
      accessibilityLabel={`${query.user.full_name}, ${details.route}, ${status.label}`}
    >
      <View style={styles.between}>
        <Text style={styles.customer} numberOfLines={1}>
          {query.user.full_name}
        </Text>
        <StatusChip label={status.label} tone={status.tone} />
      </View>
      <RouteLine origin={query.origin} destination={query.destination} returnTrip={query.trip_type === 'return'} />
      <View style={styles.fact}>
        <Icon name="calendar-outline" size={16} color={colors.muted} />
        <Text style={styles.text}>{details.dates}</Text>
      </View>
      <View style={styles.fact}>
        <Icon name="options-outline" size={16} color={colors.muted} />
        <Text style={styles.text}>{criteria(query)}</Text>
      </View>
      <Text style={styles.small}>Received {formatDateTime(query.created_at)}</Text>
    </TripCard>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  cards: { gap: space.md },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  customer: { flexShrink: 1, fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  text: { fontSize: font.body, color: colors.text, flexShrink: 1 },
  small: { fontSize: font.small, color: colors.muted },
});
