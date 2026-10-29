import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { Dashboard } from '../../api/types';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { AdminTabParamList } from '../../navigation/types';
import { colors } from '../../theme';

export function AdminDashboardScreen({ navigation }: BottomTabScreenProps<AdminTabParamList, 'AdminDashboard'>) {
  const dashboard = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: async () => (await api.get<Dashboard>('/admin/dashboard')).data,
  });

  if (dashboard.isPending) {
    return <LoadingState />;
  }
  if (dashboard.isError) {
    return <ErrorState error={dashboard.error} onRetry={() => dashboard.refetch()} />;
  }

  const data = dashboard.data;
  const tiles = [
    {
      label: 'Open requests',
      count: data.open_queries,
      onPress: () => navigation.navigate('AdminRequests', { status: 'open' }),
    },
    {
      label: 'Bookings to confirm',
      count: data.bookings_requested,
      onPress: () => navigation.navigate('AdminBookings', { status: 'requested' }),
    },
    {
      label: 'Awaiting payment',
      count: data.bookings_awaiting_payment,
      onPress: () => navigation.navigate('AdminBookings', { status: 'availability_confirmed' }),
    },
    {
      label: 'Paid, boarding pass due',
      count: data.bookings_paid_awaiting_boarding_pass,
      onPress: () => navigation.navigate('AdminBookings', { status: 'paid' }),
    },
  ];

  return (
    <Screen>
      <Text style={styles.title}>Dashboard</Text>
      <View style={styles.grid}>
        {tiles.map((tile) => (
          <Pressable
            key={tile.label}
            accessibilityRole="link"
            accessibilityLabel={`${tile.label}: ${tile.count}`}
            onPress={tile.onPress}
            style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
          >
            <Text style={styles.count}>{tile.count}</Text>
            <Text style={styles.label}>{tile.label}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    flexGrow: 1,
    flexBasis: 200,
    minWidth: 0,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 4,
  },
  pressed: { borderColor: colors.primary },
  count: { fontSize: 36, fontWeight: '700', color: colors.primary },
  label: { color: colors.text, fontWeight: '600' },
});
