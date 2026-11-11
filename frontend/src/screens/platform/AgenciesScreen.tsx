import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { Paginated, Tenant } from '../../api/types';
import { Button } from '../../components/Button';
import { Pagination } from '../../components/Pagination';
import { Screen } from '../../components/Screen';
import { SegmentedControl } from '../../components/SegmentedControl';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { Column, Table, TableRow } from '../../components/Table';
import { TextField } from '../../components/TextField';
import { TripCard } from '../../components/TripCard';
import { AgencyStatusFilter, PlatformTabParamList } from '../../navigation/types';
import { colors, font, space, useIsWide, weight } from '../../theme';
import { useListPage } from '../../utils/listPage';
import { useDebounced } from '../../utils/useDebounced';
import { AGENCIES_KEY, AgencyPage, createdOn, NewAgencyDialog, tenantStatus } from './AgencyPage';

const COLUMNS: Column[] = [
  { label: 'Name', flex: 2 },
  { label: 'Address', flex: 2.4 },
  { label: 'Status', flex: 1.2 },
  { label: 'Created', flex: 1.6 },
];

const FILTERS: { value: AgencyStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];

export function AgenciesScreen({ navigation, route }: BottomTabScreenProps<PlatformTabParamList, 'PlatformAgencies'>) {
  const selected = route.params?.id;
  const close = useCallback(() => navigation.setParams({ id: undefined }), [navigation]);
  const asTable = useIsWide();
  const [text, setText] = useState('');
  const search = useDebounced(text.trim(), 300);
  // In the URL, so the dashboard can link to a filtered list.
  const filter = route.params?.status ?? 'all';
  const [page, setPage] = useListPage(filter);
  const [creating, setCreating] = useState(false);
  const tenants = useQuery({
    queryKey: [...AGENCIES_KEY, search, filter, page],
    queryFn: async () => {
      const params = {
        page,
        ...(search ? { search } : {}),
        ...(filter !== 'all' ? { is_active: String(filter === 'active') } : {}),
      };
      return (await api.get<Paginated<Tenant>>('/platform/tenants', { params })).data;
    },
    placeholderData: keepPreviousData,
  });
  const open = (tenant: Tenant) => navigation.setParams({ id: tenant.id });
  const filtered = search !== '' || filter !== 'all';

  return (
    <View style={styles.fill}>
      {selected ? <AgencyPage key={selected} id={selected} onBack={close} /> : null}
      {/* Kept mounted under an open agency, so its search and page are still there on the way back. */}
      <View style={[styles.fill, selected !== undefined && styles.hidden]}>
        <Screen card>
          <View style={styles.header}>
            <Text style={styles.title}>Agencies</Text>
            <Button title="New agency" icon="add-outline" onPress={() => setCreating(true)} />
          </View>
          <TextField
            label="Search"
            value={text}
            onChangeText={(value) => {
              setText(value);
              setPage(1);
            }}
            placeholder="Name, address or domain"
            autoCorrect={false}
            autoCapitalize="none"
          />
          <SegmentedControl
            label="Status"
            options={FILTERS}
            value={filter}
            onChange={(value) => navigation.setParams({ status: value })}
          />
          {tenants.isPending ? (
            <LoadingState />
          ) : tenants.isError ? (
            <ErrorState error={tenants.error} onRetry={() => tenants.refetch()} />
          ) : tenants.data.results.length === 0 ? (
            <EmptyState
              icon="business-outline"
              title={filtered ? 'No matching agencies' : 'No agencies yet'}
              message={filtered ? 'No agency matches that search and status.' : 'Add the first one with New agency.'}
            />
          ) : (
            <>
              {asTable ? (
                <Table columns={COLUMNS}>
                  {tenants.data.results.map((tenant) => (
                    <AgencyTableRow key={tenant.id} tenant={tenant} onPress={() => open(tenant)} />
                  ))}
                </Table>
              ) : (
                <View style={styles.cards}>
                  {tenants.data.results.map((tenant) => (
                    <AgencyCard
                      key={tenant.id}
                      tenant={tenant}
                      selected={tenant.id === selected}
                      onPress={() => open(tenant)}
                    />
                  ))}
                </View>
              )}
              <Pagination page={page} count={tenants.data.count} onChange={setPage} />
            </>
          )}
          <NewAgencyDialog
            open={creating}
            onClose={() => setCreating(false)}
            onCreated={(tenant) => {
              setCreating(false);
              open(tenant);
            }}
          />
        </Screen>
      </View>
    </View>
  );
}

function label(tenant: Tenant) {
  return `${tenant.name}, ${tenant.primary_domain ?? tenant.slug}, ${tenantStatus(tenant).label}`;
}

function AgencyTableRow({ tenant, onPress }: { tenant: Tenant; onPress: () => void }) {
  const status = tenantStatus(tenant);
  return (
    <TableRow
      columns={COLUMNS}
      onPress={onPress}
      accessibilityLabel={label(tenant)}
      cells={[
        <Text key="name" style={styles.name} numberOfLines={1}>
          {tenant.name}
        </Text>,
        <Text key="address" style={styles.text} numberOfLines={1}>
          {tenant.primary_domain ?? '—'}
        </Text>,
        <StatusChip key="status" label={status.label} tone={status.tone} />,
        <Text key="created" style={styles.text}>
          {createdOn(tenant)}
        </Text>,
      ]}
    />
  );
}

function AgencyCard({ tenant, selected, onPress }: { tenant: Tenant; selected: boolean; onPress: () => void }) {
  const status = tenantStatus(tenant);
  return (
    <TripCard tone={status.tone} selected={selected} onPress={onPress} accessibilityLabel={label(tenant)}>
      <View style={styles.between}>
        <Text style={styles.name} numberOfLines={1}>
          {tenant.name}
        </Text>
        <StatusChip label={status.label} tone={status.tone} />
      </View>
      <Text style={styles.text} numberOfLines={1}>
        {tenant.primary_domain ?? '—'}
      </Text>
      <Text style={styles.muted}>Created {createdOn(tenant)}</Text>
    </TripCard>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hidden: { display: 'none' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  cards: { gap: space.md },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  name: { fontSize: font.body, fontWeight: weight.bold, color: colors.text, flexShrink: 1 },
  text: { color: colors.text },
  muted: { color: colors.muted },
});
