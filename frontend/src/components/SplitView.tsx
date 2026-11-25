import { UseQueryResult } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { colors, createStyles, font, radius, shadow, space, useIsWide, weight } from '../theme';
import { CompactPager, DetailContext, useCloseOnEscape } from './DetailLayout';
import { Icon } from './Icon';
import { PressState } from './pressState';
import { ErrorState, LoadingState } from './StatusViews';

const COLUMN_WIDTH = 380;

type Props = {
  /** The full page, kept mounted (filters, page, scroll) behind the split view; left out when it is another screen. */
  list?: ReactNode;
  open: boolean;
  /** The results beside the detail on wide screens. */
  column: ReactNode;
  page?: number;
  count?: number;
  onPage?: (page: number) => void;
  /** The item's title, in the detail card's header. */
  title: string;
  /** e.g. "All tours", for "Back to all tours" on a missing item. */
  backLabel: string;
  detail: ReactNode;
  onClose: () => void;
};

/**
 * Explore's item view. Wide: the results in a column on the left and the detail in a card beside it.
 * Narrow: the detail full screen. ✕ and Escape close it.
 */
export function SplitView({ list, open, column, page, count, onPage, title, backLabel, detail, onClose }: Props) {
  const isWide = useIsWide();
  useCloseOnEscape(open, onClose);

  return (
    <DetailContext.Provider value={{ close: onClose, backLabel }}>
      <View style={styles.fill}>
        {list !== undefined ? <View style={[styles.fill, open && styles.hidden]}>{list}</View> : null}
        {open ? (
          <View style={[styles.fill, styles.split]}>
            {isWide ? (
              <View style={styles.column} role="navigation" aria-label="Results">
                <ScrollView style={styles.fill} contentContainerStyle={styles.columnBody}>
                  {column}
                </ScrollView>
                <CompactPager page={page} count={count} onPage={onPage} />
              </View>
            ) : null}
            <View style={[styles.fill, isWide && styles.pane]}>
              <View style={[styles.fill, styles.card, isWide && styles.framed]} aria-label={title}>
                <View style={styles.header}>
                  <Text style={styles.title} numberOfLines={1}>
                    {title}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    onPress={onClose}
                    style={({ hovered }: PressState) => [styles.close, hovered && styles.closeHovered]}
                  >
                    <Icon name="close" size={22} color={colors.muted} />
                  </Pressable>
                </View>
                <ScrollView style={styles.fill} contentContainerStyle={styles.body}>
                  {detail}
                </ScrollView>
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </DetailContext.Provider>
  );
}

const styles = createStyles(() => ({
  fill: { flex: 1, minWidth: 0 },
  hidden: { display: 'none' },
  split: { flexDirection: 'row', backgroundColor: colors.background },
  column: { width: COLUMN_WIDTH, borderRightWidth: 1, borderRightColor: colors.border },
  columnBody: { padding: space.lg, gap: space.md },
  pane: { padding: space.lg },
  card: { backgroundColor: colors.background },
  framed: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    paddingVertical: space.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { flexShrink: 1, fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  close: { padding: space.sm, borderRadius: radius.sm },
  closeHovered: { backgroundColor: colors.background },
  body: { padding: space.lg, gap: space.lg },
}));

/** The column's results: loading, error, or one element per item. */
export function ColumnResults<T>({
  query,
  render,
}: {
  query: UseQueryResult<{ results: T[] }>;
  render: (item: T) => ReactNode;
}) {
  if (query.isPending) {
    return <LoadingState />;
  }
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  }
  if (query.data.results.length === 0) {
    return <Text style={columnStyles.empty}>Nothing on this page.</Text>;
  }
  return <>{query.data.results.map(render)}</>;
}

const columnStyles = createStyles(() => ({
  empty: { fontSize: font.small, color: colors.muted, textAlign: 'center', padding: space.lg },
}));
