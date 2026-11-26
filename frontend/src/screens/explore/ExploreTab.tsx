import { ReactNode, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { GetAppFooter } from '../../agency/GetAppFooter';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { colors, createStyles, font, space, useIsWide } from '../../theme';

const SIDEBAR = 260;
const RESULTS = 1100;
/** The content width of a module tab on wide screens: filters column, gap and results. */
export const EXPLORE_WIDTH = SIDEBAR + space.lg + RESULTS;

type Props = {
  /** A full-width band above the content (the flights search). */
  band?: ReactNode;
  /** The search card at the top of the content. */
  header?: ReactNode;
  featured?: ReactNode;
  filters: ReactNode;
  activeFilters: number;
  /** Opens the phone filters panel, e.g. to show an error in it. */
  filtersInvalid?: boolean;
  sort: ReactNode;
  /** E.g. "8 tours"; null while loading. */
  count: string | null;
  children: ReactNode;
};

/** A module tab of Explore: search, featured row, filters on the left, toolbar and results. */
export function ExploreTab(props: Props) {
  const { band, header, featured, filters, activeFilters, filtersInvalid, sort, count, children } = props;
  const compact = !useIsWide();
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    if (filtersInvalid) {
      setFiltersOpen(true);
    }
  }, [filtersInvalid]);
  const countText = count ? <Text style={styles.count}>{count}</Text> : null;

  return (
    <ScrollView style={styles.scroll}>
      {band}
      <View style={styles.body}>
        {header}
        {featured}
        <View style={[styles.main, !compact && styles.columns]}>
          {!compact ? (
            <View style={styles.sidebar}>
              <Card>{filters}</Card>
            </View>
          ) : null}
          <View style={styles.results}>
            {compact ? (
              <>
                <View style={styles.toolbar}>
                  <Button
                    title={activeFilters > 0 ? `Filters (${activeFilters})` : 'Filters'}
                    icon="options-outline"
                    variant="secondary"
                    onPress={() => setFiltersOpen((open) => !open)}
                  />
                  {countText}
                </View>
                {filtersOpen ? <Card>{filters}</Card> : null}
                {sort}
              </>
            ) : (
              <View style={styles.toolbar}>
                <View style={styles.sort}>{sort}</View>
                {countText}
              </View>
            )}
            {children}
          </View>
        </View>
        <GetAppFooter />
      </View>
    </ScrollView>
  );
}

const styles = createStyles(() => ({
  scroll: { flex: 1, backgroundColor: colors.background },
  body: {
    width: '100%',
    maxWidth: EXPLORE_WIDTH + 2 * space.lg,
    alignSelf: 'center',
    padding: space.lg,
    gap: space.lg,
  },
  main: { gap: space.lg },
  columns: { flexDirection: 'row', alignItems: 'flex-start' },
  sidebar: { width: SIDEBAR },
  results: { flex: 1, minWidth: 0, gap: space.md },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  sort: { flex: 1, maxWidth: 480 },
  count: { fontSize: font.small, color: colors.muted },
}));
