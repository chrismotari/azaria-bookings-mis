import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { Dashboard } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { Icon, IconName } from '../../components/Icon';
import { PressState } from '../../components/pressState';
import { Screen } from '../../components/Screen';
import { TONES, Tone } from '../../components/StatusChip';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { AdminTabParamList } from '../../navigation/types';
import { colors, font, radius, shadow, shadowRaised, space, weight } from '../../theme';

/** "Good morning" etc. by the time of day in Nairobi. */
function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Africa/Nairobi' }).format(
      new Date(),
    ),
  );
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

type Tile = {
  label: string;
  count: number;
  icon: IconName;
  tone: Tone;
  /** Needs the admin to act when the count is not zero; such tiles are emphasised. */
  needsAction: boolean;
  onPress: () => void;
};

export function AdminDashboardScreen({ navigation }: BottomTabScreenProps<AdminTabParamList, 'AdminDashboard'>) {
  const { user } = useAuth();
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
  const tiles: Tile[] = [
    {
      label: 'Open requests',
      count: data.open_queries,
      icon: 'chatbubbles-outline',
      tone: 'info',
      needsAction: false,
      onPress: () => navigation.navigate('AdminRequests', { status: 'open' }),
    },
    {
      label: 'Bookings to confirm',
      count: data.bookings_requested,
      icon: 'checkmark-done-outline',
      tone: 'warning',
      needsAction: true,
      onPress: () => navigation.navigate('AdminBookings', { status: 'requested' }),
    },
    {
      label: 'Awaiting payment',
      count: data.bookings_awaiting_payment,
      icon: 'card-outline',
      tone: 'neutral',
      needsAction: false,
      onPress: () => navigation.navigate('AdminBookings', { status: 'availability_confirmed' }),
    },
    {
      label: 'Paid, boarding pass due',
      count: data.bookings_paid_awaiting_boarding_pass,
      icon: 'document-attach-outline',
      tone: 'success',
      needsAction: true,
      onPress: () => navigation.navigate('AdminBookings', { status: 'paid' }),
    },
  ];
  const firstName = user?.full_name.trim().split(/\s+/)[0];

  return (
    <Screen>
      <View>
        <Text style={styles.title}>Dashboard</Text>
        <Text style={styles.greeting}>
          {greeting()}
          {firstName ? `, ${firstName}` : ''}.
        </Text>
      </View>
      <View style={styles.grid}>
        {tiles.map((tile) => (
          <DashboardTile key={tile.label} tile={tile} />
        ))}
      </View>
    </Screen>
  );
}

function DashboardTile({ tile }: { tile: Tile }) {
  const { background, color } = TONES[tile.tone];
  const emphasised = tile.needsAction && tile.count > 0;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${tile.label}: ${tile.count}${emphasised ? ', needs action' : ''}`}
      onPress={tile.onPress}
      style={({ pressed, hovered }: PressState) => [
        styles.tile,
        { borderTopColor: color },
        emphasised && { backgroundColor: background, borderColor: color },
        (pressed || hovered) && styles.hovered,
      ]}
    >
      <View style={styles.tileTop}>
        <View style={[styles.iconCircle, { backgroundColor: emphasised ? colors.surface : background }]}>
          <Icon name={tile.icon} size={22} color={color} />
        </View>
        {emphasised ? <Text style={[styles.badge, { color }]}>Needs action</Text> : null}
      </View>
      <Text style={styles.count}>{tile.count}</Text>
      <Text style={styles.label}>{tile.label}</Text>
      <View style={styles.view}>
        <Text style={styles.viewText}>View</Text>
        <Icon name="arrow-forward" size={16} color={colors.primary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  greeting: { fontSize: font.body, color: colors.muted, marginTop: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: {
    flexGrow: 1,
    flexBasis: 220,
    minWidth: 0,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 4,
    padding: space.lg,
    gap: space.xs,
    ...shadow,
  },
  hovered: shadowRaised,
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
  iconCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  badge: { fontSize: font.caption, fontWeight: weight.bold, textTransform: 'uppercase' },
  count: { fontSize: font.display, fontWeight: weight.heavy, color: colors.text },
  label: { fontSize: font.body, fontWeight: weight.semibold, color: colors.text },
  view: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.sm },
  viewText: { fontSize: font.small, fontWeight: weight.bold, color: colors.primary },
});
