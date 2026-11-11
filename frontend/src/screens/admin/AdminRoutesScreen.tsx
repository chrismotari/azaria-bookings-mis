import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { Integration, Paginated, Route, SearchRun } from '../../api/types';
import { ActionBar } from '../../components/ActionBar';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DateField } from '../../components/DateField';
import { DetailLayout } from '../../components/DetailLayout';
import { Dialog } from '../../components/Dialog';
import { FieldGrid } from '../../components/Field';
import { Pagination } from '../../components/Pagination';
import { Screen } from '../../components/Screen';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { Column, RouteCell, Table, TableRow, TwoLineCell } from '../../components/Table';
import { AdminTabParamList } from '../../navigation/types';
import { colors, font, radius, space, useIsWide, weight } from '../../theme';
import { formatDateTime, ticketClassLabel, todayInNairobi } from '../../utils/format';
import { useListPage, useMissingPageReset } from '../../utils/listPage';
import {
  FARES_KEY,
  ROUTES_KEY,
  RUN_STATUS,
  USAGE_KEY,
  connectionsLabel,
  markupLabel,
  pickRuleLabel,
  routeIntegrationCount,
  runDates,
  searchDates,
  tripLabel,
  useIntegrations,
  useSearchUsage,
  weekdaysLabel,
} from './gds';
import { RouteForm } from './RouteForm';

/** The longest departure date range one search covers. */
const MAX_SEARCH_DAYS = 60;

export function AdminRoutesScreen({ navigation, route }: BottomTabScreenProps<AdminTabParamList, 'AdminRoutes'>) {
  const isWide = useIsWide();
  const selected = route.params?.id;
  const close = useCallback(() => navigation.setParams({ id: undefined }), [navigation]);
  const asTable = isWide && selected === undefined;
  const [page, setPage] = useListPage(null);
  const [creating, setCreating] = useState(false);
  const integrations = useIntegrations();
  const usage = useSearchUsage();

  const routes = useQuery({
    queryKey: [...ROUTES_KEY, page],
    queryFn: async () => (await api.get<Paginated<Route>>('/admin/routes', { params: { page } })).data,
    placeholderData: keepPreviousData,
  });
  useMissingPageReset(routes.error, page, setPage);

  const rows = routes.data?.results.map((item) => (
    <RouteRow
      key={item.id}
      item={item}
      wide={asTable}
      selected={item.id === selected}
      onOpen={() => navigation.setParams({ id: item.id })}
      onFares={() => navigation.navigate('AdminFares', { route: item.id })}
    />
  ));

  return (
    <DetailLayout
      title="Route"
      backLabel="All routes"
      onClose={close}
      detail={
        selected ? (
          <RouteDetailView key={selected} id={selected} integrations={integrations.data ?? []} />
        ) : null
      }
      list={
        <Screen card>
          <View style={styles.header}>
            <View style={styles.shrink}>
              <Text style={styles.title}>Routes</Text>
              {usage.data ? (
                <Text style={styles.muted}>
                  {usage.data.left.toLocaleString('en-US')} of {usage.data.allowance.toLocaleString('en-US')} searches
                  left this month
                </Text>
              ) : null}
            </View>
            <Button title="New route" onPress={() => setCreating(true)} />
          </View>

          {routes.isPending ? (
            <LoadingState />
          ) : routes.isError ? (
            <ErrorState error={routes.error} onRetry={() => routes.refetch()} />
          ) : routes.data.results.length === 0 ? (
            <EmptyState
              icon="git-branch-outline"
              title="No routes yet"
              message="Add the routes you sell, then search them over a range of dates and publish the fares you choose."
              action={{ title: 'New route', onPress: () => setCreating(true) }}
            />
          ) : (
            <>
              {asTable ? <Table columns={COLUMNS}>{rows}</Table> : <View style={styles.cards}>{rows}</View>}
              <Pagination page={page} count={routes.data.count} onChange={setPage} />
            </>
          )}

          <Dialog open={creating} title="New route" size="large" onClose={() => setCreating(false)} footer={null}>
            {creating ? (
              <RouteForm
                integrations={integrations.data ?? []}
                onCancel={() => setCreating(false)}
                onSaved={(created) => {
                  setCreating(false);
                  navigation.setParams({ id: created.id });
                }}
              />
            ) : null}
          </Dialog>
        </Screen>
      }
    />
  );
}

const COLUMNS: Column[] = [
  { label: 'Route', flex: 2 },
  { label: 'Trip and stay', flex: 1.8 },
  { label: 'Cabin', flex: 1.6 },
  { label: 'Last run', flex: 2.4 },
  { label: 'New fares', flex: 1.6 },
];

type RowProps = { item: Route; wide: boolean; selected: boolean; onOpen: () => void; onFares: () => void };

function LastRun({ run }: { run: SearchRun | null }) {
  if (!run) {
    return <Text style={styles.muted}>Not searched yet</Text>;
  }
  const status = RUN_STATUS[run.status];
  return (
    <View style={styles.lastRun}>
      <StatusChip label={status.label} tone={status.tone} />
      <Text style={styles.small} numberOfLines={1}>
        {formatDateTime(run.created_at)}
      </Text>
    </View>
  );
}

function NewFares({ item, onFares }: { item: Route; onFares: () => void }) {
  return (
    <View style={styles.newFares}>
      {item.new_fares ? <StatusChip label={`${item.new_fares} new`} tone="info" /> : <Text style={styles.muted}>None</Text>}
      {item.last_run ? <Button title="Fares" variant="link" onPress={onFares} /> : null}
    </View>
  );
}

function RouteRow({ item, wide, selected, onOpen, onFares }: RowProps) {
  const route = (
    <RouteCell origin={item.origin} destination={item.destination} returnTrip={item.trip_type === 'return'} />
  );
  if (wide) {
    return (
      <TableRow
        columns={COLUMNS}
        selected={selected}
        cells={[
          <View key="route" style={styles.routeCell}>
            {route}
            <Button title="Open" variant="link" onPress={onOpen} />
          </View>,
          <TwoLineCell key="trip" primary={tripLabel(item)} secondary={weekdaysLabel(item.weekdays)} />,
          <TwoLineCell
            key="cabin"
            primary={ticketClassLabel(item.ticket_class)}
            secondary={item.is_active ? undefined : 'Inactive'}
          />,
          <LastRun key="run" run={item.last_run} />,
          <NewFares key="fares" item={item} onFares={onFares} />,
        ]}
      />
    );
  }
  return (
    <Card selected={selected}>
      <View style={styles.between}>
        {route}
        {item.is_active ? null : <StatusChip label="Inactive" tone="neutral" />}
      </View>
      <Text style={styles.text}>
        {tripLabel(item)} · {ticketClassLabel(item.ticket_class)} · {weekdaysLabel(item.weekdays)}
      </Text>
      <LastRun run={item.last_run} />
      <View style={styles.between}>
        <NewFares item={item} onFares={onFares} />
        <Button title="Open" variant="secondary" onPress={onOpen} />
      </View>
    </Card>
  );
}

function RouteDetailView({ id, integrations }: { id: string; integrations: Integration[] }) {
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const [searching, setSearching] = useState(false);
  const route = useQuery({
    queryKey: [...ROUTES_KEY, 'detail', id],
    queryFn: async () => (await api.get<Route>(`/admin/routes/${id}`)).data,
  });

  if (route.isPending) {
    return <LoadingState />;
  }
  if (route.isError) {
    if (isAxiosError(route.error) && route.error.response?.status === 404) {
      return <EmptyState icon="git-branch-outline" title="Route not found" message="This route does not exist." />;
    }
    return <ErrorState error={route.error} onRetry={() => route.refetch()} />;
  }

  const data = route.data;
  return (
    <>
      <ActionBar>
        <Button
          title="View fares"
          variant="secondary"
          disabled={!data.last_run}
          onPress={() => navigation.navigate('AdminTabs', { screen: 'AdminFares', params: { route: id } })}
        />
        <Button title="Search now" icon="search" onPress={() => setSearching(true)} disabled={!data.is_active} />
      </ActionBar>
      <Card>
        <RouteCell origin={data.origin} destination={data.destination} returnTrip={data.trip_type === 'return'} />
        <Text style={styles.text}>
          {tripLabel(data)} · {ticketClassLabel(data.ticket_class)} · {connectionsLabel(data.max_connections)}
        </Text>
        <Text style={styles.muted}>
          {weekdaysLabel(data.weekdays)} · {pickRuleLabel(data)} · Markup {markupLabel(data)}
        </Text>
        {data.is_active ? null : <Text style={styles.warning}>Inactive: activate it below to search it.</Text>}
      </Card>
      <RecentRuns id={id} />
      <Card>
        <Text style={styles.section}>Settings</Text>
        <RouteForm
          key={data.id}
          route={data}
          integrations={integrations}
          onSaved={(saved) => queryClient.setQueryData([...ROUTES_KEY, 'detail', id], saved)}
        />
      </Card>
      {searching ? (
        <SearchNowDialog route={data} integrations={integrations} onClose={() => setSearching(false)} />
      ) : null}
    </>
  );
}

function RecentRuns({ id }: { id: string }) {
  const runs = useQuery({
    queryKey: [...ROUTES_KEY, 'runs', id],
    queryFn: async () => (await api.get<Paginated<SearchRun>>(`/admin/routes/${id}/runs`)).data,
    // A queued or running search finishes in the background.
    refetchInterval: (query) =>
      query.state.data?.results.some((run) => run.status === 'queued' || run.status === 'running') ? 3000 : false,
  });
  const queryClient = useQueryClient();
  const busy = runs.data?.results.some((run) => run.status === 'queued' || run.status === 'running') ?? false;
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      // A run just finished: its fares and counts are new.
      queryClient.invalidateQueries({ queryKey: ROUTES_KEY });
      queryClient.invalidateQueries({ queryKey: FARES_KEY });
      queryClient.invalidateQueries({ queryKey: USAGE_KEY });
    }
    wasBusy.current = busy;
  }, [busy, queryClient]);

  return (
    <Card>
      <Text style={styles.section}>Recent runs</Text>
      {runs.isPending ? (
        <LoadingState />
      ) : runs.isError ? (
        <ErrorState error={runs.error} onRetry={() => runs.refetch()} />
      ) : runs.data.results.length === 0 ? (
        <Text style={styles.muted}>Not searched yet. Use Search now to look for fares.</Text>
      ) : (
        <View style={styles.runs}>
          {runs.data.results.slice(0, 10).map((run) => (
            <RunItem key={run.id} run={run} />
          ))}
        </View>
      )}
    </Card>
  );
}

function RunItem({ run }: { run: SearchRun }) {
  const navigation = useNavigation();
  const status = RUN_STATUS[run.status];
  return (
    <View style={styles.run}>
      <View style={styles.between}>
        <Text style={styles.strong}>{runDates(run)}</Text>
        <StatusChip label={status.label} tone={status.tone} />
      </View>
      <Text style={styles.small}>
        {formatDateTime(run.created_at)}
        {run.started_by ? ` · ${run.started_by}` : ''} · {run.searches_made} search
        {run.searches_made === 1 ? '' : 'es'} · {run.fares_found} fare{run.fares_found === 1 ? '' : 's'}
      </Text>
      {run.errors.map((message, index) => (
        <Text key={index} style={styles.error}>
          {message}
        </Text>
      ))}
      {run.status === 'done' || run.status === 'failed' ? (
        <Button
          title="Fares from this run"
          variant="link"
          onPress={() =>
            navigation.navigate('AdminTabs', { screen: 'AdminFares', params: { route: run.route, run: run.id } })
          }
        />
      ) : null}
    </View>
  );
}

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function SearchNowDialog({ route, integrations, onClose }: { route: Route; integrations: Integration[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const usage = useSearchUsage();
  const today = todayInNairobi();
  const [from, setFrom] = useState(addDays(today, 7));
  const [to, setTo] = useState(addDays(today, 13));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to);
  const rangeError = !valid
    ? 'Choose both dates.'
    : from < today
      ? 'The first departure date cannot be in the past.'
      : to < from
        ? 'The last departure date must be on or after the first.'
        : searchDates(from, to, []).length > MAX_SEARCH_DAYS
          ? `Search at most ${MAX_SEARCH_DAYS} days at a time.`
          : null;
  const dates = rangeError ? [] : searchDates(from, to, route.weekdays);
  const integrationCount = routeIntegrationCount(route, integrations);
  const needed = dates.length * integrationCount;
  const left = usage.data?.left;
  const over = left !== undefined && needed > left;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/routes/${route.id}/search`, { date_from: from, date_to: to });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ROUTES_KEY }),
        queryClient.invalidateQueries({ queryKey: USAGE_KEY }),
      ]);
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title={`Search ${route.origin.code} ${route.trip_type === 'return' ? '⇄' : '→'} ${route.destination.code}`}
      onClose={onClose}
      busy={busy}
      error={error}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={busy} />
          <Button
            title="Search now"
            onPress={start}
            loading={busy}
            disabled={rangeError !== null || needed === 0 || over}
          />
        </>
      }
    >
      <Text style={styles.text}>
        One search per departure date{route.weekdays.length ? ` (${weekdaysLabel(route.weekdays)})` : ''} with each
        integration. Results appear under the route's fares when the run is done.
      </Text>
      <FieldGrid columns={2}>
        <DateField label="First departure" value={from} onChange={setFrom} />
        <DateField label="Last departure" value={to} onChange={setTo} />
      </FieldGrid>
      {rangeError ? <Text style={styles.error}>{rangeError}</Text> : null}
      <View style={styles.summary}>
        <SummaryLine label="Departure dates" value={String(dates.length)} />
        <SummaryLine label="Integrations" value={String(integrationCount)} />
        <SummaryLine label="Searches needed" value={String(needed)} strong />
        <SummaryLine
          label="Left this month"
          value={left === undefined ? '…' : `${left.toLocaleString('en-US')} of ${usage.data?.allowance.toLocaleString('en-US')}`}
        />
      </View>
      {integrationCount === 0 ? <Text style={styles.error}>No active integration to search with.</Text> : null}
      {!rangeError && dates.length === 0 ? (
        <Text style={styles.error}>No date in this range falls on the route's departure days.</Text>
      ) : null}
      {over ? <Text style={styles.error}>This needs more searches than are left this month.</Text> : null}
    </Dialog>
  );
}

function SummaryLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.between}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={[styles.text, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  section: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  cards: { gap: space.md },
  shrink: { flexShrink: 1, minWidth: 0 },
  between: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  routeCell: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.md },
  lastRun: { gap: 2, alignItems: 'flex-start' },
  newFares: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  text: { color: colors.text },
  strong: { fontWeight: weight.bold, color: colors.text },
  muted: { color: colors.muted },
  small: { fontSize: font.small, color: colors.muted },
  warning: { color: colors.warningText, fontWeight: weight.semibold },
  error: { fontSize: font.small, color: colors.dangerText },
  runs: { gap: space.sm },
  run: {
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summary: { gap: space.xs, padding: space.md, borderRadius: radius.md, backgroundColor: colors.background },
});
