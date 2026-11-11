import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { AdminCustomer, Paginated } from '../../api/types';
import { Button } from '../../components/Button';
import { DetailLayout } from '../../components/DetailLayout';
import { Pagination } from '../../components/Pagination';
import { Screen } from '../../components/Screen';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { Column, Table, TableRow } from '../../components/Table';
import { TextField } from '../../components/TextField';
import { TripCard } from '../../components/TripCard';
import { AdminTabParamList } from '../../navigation/types';
import { colors, font, space, useIsWide, weight } from '../../theme';
import { useDebounced } from '../../utils/useDebounced';
import { AdminUserDetailView, NewUserDialog, USER_STATUS } from './AdminUserDetailView';

const COLUMNS: Column[] = [
  { label: 'Name', flex: 2 },
  { label: 'Email', flex: 2.4 },
  { label: 'Phone', flex: 1.6 },
  { label: 'Status', flex: 1.2 },
];

export function AdminUsersScreen({ navigation, route }: BottomTabScreenProps<AdminTabParamList, 'AdminUsers'>) {
  const selected = route.params?.id;
  // In the URL, so a reload or a shared link keeps the System admins list.
  const admins = route.params?.role === 'admin';
  const close = useCallback(() => navigation.setParams({ id: undefined }), [navigation]);
  // With a customer open the list is too narrow for the table.
  const asTable = useIsWide() && selected === undefined;
  const [text, setText] = useState('');
  const search = useDebounced(text.trim(), 300);
  const [page, setPage] = useState(1);
  const showAdmins = (value: boolean) => {
    setPage(1);
    setNotice(null);
    navigation.setParams({ role: value ? 'admin' : undefined, id: undefined });
  };
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const users = useQuery({
    queryKey: ['admin', 'users', admins ? 'admins' : 'customers', search, page],
    queryFn: async () => {
      const params = { page, ...(search ? { search } : {}), ...(admins ? { role: 'admin' } : {}) };
      return (await api.get<Paginated<AdminCustomer>>('/admin/users', { params })).data;
    },
    placeholderData: keepPreviousData,
  });
  const open = (user: AdminCustomer) => navigation.setParams({ id: user.id });

  return (
    <DetailLayout
      title={admins ? 'Admin' : 'Customer'}
      backLabel={admins ? 'All system admins' : 'All users'}
      onClose={close}
      detail={
        selected ? (
          <AdminUserDetailView
            key={selected}
            id={selected}
            onPromoted={(message) => {
              setNotice(message);
              close();
            }}
          />
        ) : null
      }
      list={
        <Screen card>
          <View style={styles.header}>
            <Text style={styles.title}>{admins ? 'System admins' : 'Users'}</Text>
            <View style={styles.buttons}>
              <Button
                title={admins ? 'Customers' : 'System admins'}
                variant="secondary"
                icon={admins ? 'people-outline' : 'shield-checkmark-outline'}
                onPress={() => showAdmins(!admins)}
              />
              <Button title="New user" icon="person-add-outline" onPress={() => setCreating(true)} />
            </View>
          </View>
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          <TextField
            label="Search"
            value={text}
            onChangeText={(value) => {
              setText(value);
              setPage(1);
            }}
            placeholder="Name, email or phone"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {users.isPending ? (
            <LoadingState />
          ) : users.isError ? (
            <ErrorState error={users.error} onRetry={() => users.refetch()} />
          ) : users.data.results.length === 0 ? (
            <EmptyState
              icon="people-outline"
              title={search ? (admins ? 'No matching admins' : 'No matching customers') : 'No customers yet'}
              message={
                search
                  ? 'Nobody matches that name, email or phone.'
                  : 'Customers appear here when they register or when you add them.'
              }
            />
          ) : (
            <>
              {asTable ? (
                <Table columns={COLUMNS}>
                  {users.data.results.map((user) => (
                    <UserTableRow key={user.id} user={user} onPress={() => open(user)} />
                  ))}
                </Table>
              ) : (
                <View style={styles.cards}>
                  {users.data.results.map((user) => (
                    <UserCard key={user.id} user={user} selected={user.id === selected} onPress={() => open(user)} />
                  ))}
                </View>
              )}
              <Pagination page={page} count={users.data.count} onChange={setPage} />
            </>
          )}
          <NewUserDialog
            open={creating}
            onClose={() => setCreating(false)}
            onCreated={(user) => {
              setCreating(false);
              // New users are customers: show them in that list.
              navigation.setParams({ role: undefined, id: user.id });
            }}
          />
        </Screen>
      }
    />
  );
}

function UserTableRow({ user, onPress }: { user: AdminCustomer; onPress: () => void }) {
  const status = USER_STATUS[String(user.is_active)];
  return (
    <TableRow
      columns={COLUMNS}
      onPress={onPress}
      accessibilityLabel={`${user.full_name}, ${user.email}, ${status.label}`}
      cells={[
        <Text key="name" style={styles.name} numberOfLines={1}>
          {user.full_name}
        </Text>,
        <Text key="email" style={styles.text} numberOfLines={1}>
          {user.email}
        </Text>,
        <Text key="phone" style={styles.text}>
          {user.phone || '—'}
        </Text>,
        <StatusChip key="status" label={status.label} tone={status.tone} />,
      ]}
    />
  );
}

function UserCard({ user, selected, onPress }: { user: AdminCustomer; selected: boolean; onPress: () => void }) {
  const status = USER_STATUS[String(user.is_active)];
  return (
    <TripCard
      tone={status.tone}
      selected={selected}
      onPress={onPress}
      accessibilityLabel={`${user.full_name}, ${user.email}, ${status.label}`}
    >
      <View style={styles.between}>
        <Text style={styles.name} numberOfLines={1}>
          {user.full_name}
        </Text>
        <StatusChip label={status.label} tone={status.tone} />
      </View>
      <Text style={styles.text} numberOfLines={1}>
        {user.email}
      </Text>
      {user.phone ? <Text style={styles.muted}>{user.phone}</Text> : null}
    </TripCard>
  );
}

const styles = StyleSheet.create({
  notice: { color: colors.successText, fontWeight: weight.semibold },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
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
