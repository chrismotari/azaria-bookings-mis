import { useQuery } from '@tanstack/react-query';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';

import { api } from '../api/client';
import { AgencyInfo } from '../api/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { ErrorState, LoadingState } from '../components/StatusViews';
import { APP_SCHEME, APP_STORE_URL, PLAY_STORE_URL } from '../config';
import { colors, font, radius, space, weight } from '../theme';

export function useAgencyInfo() {
  return useQuery({
    queryKey: ['agency'],
    queryFn: async () => (await api.get<AgencyInfo>('/agency')).data,
    staleTime: Infinity,
  });
}

function openStore(url: string) {
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener');
  } else {
    void Linking.openURL(url);
  }
}

/** Web: /app on an agency's site, leading its customers to the shared mobile app. */
export function GetAppScreen() {
  const agency = useAgencyInfo();
  if (agency.isPending) {
    return <LoadingState />;
  }
  if (agency.isError) {
    return <ErrorState error={agency.error} onRetry={() => agency.refetch()} />;
  }
  const { name, code } = agency.data;
  const openInApp = () => {
    // A custom scheme opens the installed app; a new tab would stay blank.
    window.location.href = `${APP_SCHEME}://open?agency=${encodeURIComponent(code)}`;
  };
  return (
    <Screen maxWidth={560}>
      <Card>
        <View style={styles.header}>
          <View style={styles.icon}>
            <Icon name="phone-portrait-outline" size={26} color={colors.primary} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.title}>Get the app</Text>
            <Text style={styles.subtitle}>Use {name} on your phone with the Azaria Bookings app.</Text>
          </View>
        </View>
        <View style={styles.codeBox}>
          <Text style={styles.codeLabel}>Agency code</Text>
          <Text style={styles.code} selectable>
            {code}
          </Text>
          <Text style={styles.codeHelp}>The app asks for it the first time, unless you open it from a link.</Text>
        </View>
        {APP_STORE_URL || PLAY_STORE_URL ? (
          <View style={styles.stores}>
            {APP_STORE_URL ? (
              <Button title="App Store" icon="logo-apple" onPress={() => openStore(APP_STORE_URL)} />
            ) : null}
            {PLAY_STORE_URL ? (
              <Button title="Google Play" icon="logo-google-playstore" onPress={() => openStore(PLAY_STORE_URL)} />
            ) : null}
          </View>
        ) : null}
        <Text style={styles.note}>After installing, tap the link in your email again.</Text>
        <View style={styles.installed}>
          <Text style={styles.note}>Already installed?</Text>
          <Button title="Open in the app" variant="secondary" icon="open-outline" onPress={openInApp} />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flexShrink: 1, gap: 2 },
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  subtitle: { fontSize: font.body, color: colors.muted },
  codeBox: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: space.lg,
    alignItems: 'center',
    gap: space.xs,
  },
  codeLabel: { fontSize: font.small, fontWeight: weight.semibold, color: colors.muted },
  code: { fontSize: font.display, fontWeight: weight.heavy, color: colors.primary, letterSpacing: 1 },
  codeHelp: { fontSize: font.small, color: colors.muted, textAlign: 'center' },
  stores: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  note: { fontSize: font.body, color: colors.text },
  installed: { gap: space.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.lg },
});
