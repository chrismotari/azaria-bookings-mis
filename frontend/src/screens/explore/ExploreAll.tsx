import { useQuery } from '@tanstack/react-query';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { GetAppFooter } from '../../agency/GetAppFooter';
import { useModules } from '../../agency/modules';
import { api } from '../../api/client';
import { AgencyInfo, Module } from '../../api/types';
import { Card } from '../../components/Card';
import { Icon, IconName } from '../../components/Icon';
import { PressState } from '../../components/pressState';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { colors, createStyles, font, radius, shadowRaised, space, useIsWide, weight } from '../../theme';
import { CardSection, cardCount, useExplore } from './Featured';

const HERO: Record<Module, { title: string; line: string; icon: IconName }> = {
  flights: { title: 'Flights', line: 'Find a flight', icon: 'airplane' },
  tours: { title: 'Tours', line: 'Join a tour', icon: 'map' },
  hotels: { title: 'Hotels', line: 'Book a stay', icon: 'bed' },
};

const SECTION: Record<Module, string> = {
  flights: 'Featured flights',
  tours: 'Featured tours',
  hotels: 'Featured hotels',
};

/** Explore's All tab: a tile per module, then each module's featured cards. */
export function ExploreAll({ onOpen }: { onOpen: (module: Module) => void }) {
  const modules = useModules();
  const isWide = useIsWide();
  const agency = useQuery({
    queryKey: ['agency'],
    queryFn: async () => (await api.get<AgencyInfo>('/agency')).data,
  });
  const explore = useExplore();
  const shown = modules.filter((module) => cardCount(explore.data, module) > 0);

  return (
    <ScrollView style={styles.scroll}>
      <View style={styles.body}>
        <View style={styles.hero}>
          <Text style={styles.agency} accessibilityRole="header">
            {agency.data?.name ?? ' '}
          </Text>
          <View style={[styles.tiles, isWide && styles.tilesWide]}>
            {modules.map((module) => (
              <Pressable
                key={module}
                accessibilityRole="link"
                accessibilityLabel={`${HERO[module].title}: ${HERO[module].line.toLowerCase()}`}
                onPress={() => onOpen(module)}
                style={({ hovered, pressed }: PressState) => [
                  styles.tile,
                  isWide && styles.tileWide,
                  (hovered || pressed) && styles.tileHovered,
                ]}
              >
                <View style={styles.tileIcon}>
                  <Icon name={HERO[module].icon} size={28} color={colors.primary} />
                </View>
                <View style={styles.tileText}>
                  <Text style={styles.tileTitle}>{HERO[module].title}</Text>
                  <Text style={styles.tileLine}>{HERO[module].line}</Text>
                </View>
                <Icon name="arrow-forward" size={20} color={colors.primaryText} />
              </Pressable>
            ))}
          </View>
        </View>

        {explore.isPending ? (
          <LoadingState />
        ) : explore.isError ? (
          <ErrorState error={explore.error} onRetry={() => explore.refetch()} />
        ) : shown.length === 0 ? (
          <Card>
            <EmptyState icon="compass-outline" title="Nothing on offer right now" message="Check back soon." />
          </Card>
        ) : (
          shown.map((module) => (
            <CardSection
              key={module}
              title={SECTION[module]}
              module={module}
              cards={explore.data}
              onSeeAll={() => onOpen(module)}
            />
          ))
        )}
        <GetAppFooter />
      </View>
    </ScrollView>
  );
}

const styles = createStyles(() => ({
  scroll: { flex: 1, backgroundColor: colors.background },
  body: { width: '100%', maxWidth: 1100 + 2 * space.lg, alignSelf: 'center', padding: space.lg, gap: space.xl },
  hero: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: space.xl, gap: space.lg },
  agency: { fontSize: font.display, fontWeight: weight.heavy, color: colors.primaryText },
  tiles: { gap: space.md },
  tilesWide: { flexDirection: 'row' },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.primaryHover,
    borderWidth: 1,
    borderColor: colors.primaryHover,
  },
  tileWide: { flex: 1, minWidth: 0, minHeight: 120 },
  tileHovered: { borderColor: colors.primaryText, ...shadowRaised },
  tileIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileText: { flex: 1, minWidth: 0, gap: 2 },
  tileTitle: { fontSize: font.heading, fontWeight: weight.heavy, color: colors.primaryText },
  tileLine: { fontSize: font.body, color: colors.primaryText },
}));
