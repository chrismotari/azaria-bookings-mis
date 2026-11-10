import { useNavigation } from '@react-navigation/native';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { Icon, IconName } from '../../components/Icon';
import { Screen } from '../../components/Screen';
import { colors, font, radius, shadow, space, useIsWide, weight } from '../../theme';

const POINTS: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'business-outline',
    title: 'Your own site',
    text: 'Each agency gets its own address, and its own customers, deals and bookings, kept apart from every other agency.',
  },
  {
    icon: 'airplane-outline',
    title: 'Deals, requests and bookings in one place',
    text: 'Publish flight deals, answer customers who ask for options, confirm seats and record payments.',
  },
  {
    icon: 'ticket-outline',
    title: 'Boarding passes, delivered',
    text: 'Upload boarding passes once: customers get them by email and can open them in the app.',
  },
];

/** The root host's public home page: what the system is, and the way in for the system owner. */
export function PlatformHomeScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const isWide = useIsWide();
  return (
    <Screen maxWidth={1040}>
      <View style={[styles.hero, !isWide && styles.heroNarrow]}>
        <Text style={[styles.headline, !isWide && styles.headlineNarrow]}>A booking site for every travel agency</Text>
        <Text style={styles.lead}>
          Azaria Bookings gives travel agencies their own booking site: publish flight deals, answer customers'
          requests, take bookings and send boarding passes, without spreadsheets or long email threads.
        </Text>
        <View style={styles.actions}>
          <Button
            title={user ? 'Open admin' : 'Admin sign in'}
            variant="accent"
            icon={user ? 'grid-outline' : 'log-in-outline'}
            onPress={() =>
              user
                ? navigation.navigate('PlatformTabs', { screen: 'PlatformDashboard' })
                : navigation.navigate('PlatformLogin')
            }
          />
        </View>
      </View>
      <View style={[styles.points, isWide && styles.pointsWide]}>
        {POINTS.map((point) => (
          <View key={point.title} style={[styles.point, isWide && styles.pointWide]}>
            <View style={styles.icon}>
              <Icon name={point.icon} size={22} color={colors.primary} />
            </View>
            <Text style={styles.pointTitle}>{point.title}</Text>
            <Text style={styles.pointText}>{point.text}</Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: space.xxl,
    gap: space.lg,
    marginTop: space.lg,
  },
  heroNarrow: { padding: space.xl, marginTop: 0 },
  headline: { fontSize: font.display, fontWeight: weight.heavy, color: colors.primaryText },
  headlineNarrow: { fontSize: font.title },
  lead: { fontSize: font.heading, lineHeight: 28, color: colors.primaryText, opacity: 0.92, maxWidth: 680 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.sm },
  points: { gap: space.md },
  pointsWide: { flexDirection: 'row', alignItems: 'stretch' },
  point: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.sm,
    ...shadow,
  },
  pointWide: { flex: 1 },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointTitle: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  pointText: { fontSize: font.body, color: colors.muted, lineHeight: 22 },
});
