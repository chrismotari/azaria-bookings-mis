import { useIsFocused } from '@react-navigation/native';
import { isAxiosError } from 'axios';
import { createContext, ReactNode, useContext, useEffect, useSyncExternalStore } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, space, useIsWide, weight } from '../theme';
import { Button } from './Button';
import { Icon } from './Icon';
import { PAGE_SIZE } from './Pagination';
import { PressState } from './pressState';
import { EmptyState, ErrorState, LoadingState } from './StatusViews';

const RAIL_WIDTH = 280;
const STRIP_WIDTH = 44;

/** One row of the slim list: what identifies the item and one time. */
export type RailItem = {
  id: string;
  primary: string;
  secondary: string;
  /** Also carries the status, which the row does not show. */
  accessibilityLabel: string;
  /** Unread chats. */
  strong?: boolean;
};

export type Rail = {
  /** The list's title, e.g. "Chats". */
  title: string;
  /** The rows of the page loaded in the list; undefined while it loads or after an error. */
  items: RailItem[] | undefined;
  onSelect: (id: string) => void;
  /** The list's page and total, for the compact pager; leave out for unpaged lists. */
  page?: number;
  count?: number;
  onPage?: (page: number) => void;
};

type Props = {
  /** The list screen; it stays mounted (filters, page, scroll) while a detail is open. */
  list: ReactNode;
  /** The same list, slim, beside an open detail on wide screens. */
  rail: Rail;
  selected: string | undefined;
  /** Null when nothing is selected. */
  detail: ReactNode | null;
  /** Detail heading on wide screens, e.g. "Booking". */
  title: string;
  /** Back link on narrow screens, e.g. "All bookings". */
  backLabel: string;
  onClose: () => void;
};

const DetailContext = createContext<{ close: () => void; backLabel: string } | null>(null);

/**
 * Wide: with an item open, the list becomes a slim rail on the left (collapsible) and the detail fills the rest.
 * Narrow: the detail is full screen with a back link.
 */
export function DetailLayout({ list, rail, selected, detail, title, backLabel, onClose }: Props) {
  const isWide = useIsWide();
  const open = detail !== null;
  useCloseOnEscape(open, onClose);

  return (
    <DetailContext.Provider value={{ close: onClose, backLabel }}>
      <View style={[styles.fill, isWide && styles.row]}>
        {/* Kept mounted while a detail is open, so its filters, page and scroll are there on the way back. */}
        <View style={[styles.fill, open && styles.hidden]}>{list}</View>
        {open && isWide ? (
          <>
            <RailView rail={rail} selected={selected} />
            <View style={[styles.fill, styles.detail]} aria-label={title}>
              <View style={styles.detailHeader}>
                <Text style={styles.detailTitle}>{title}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
                  <Text style={styles.closeText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView style={styles.fill} contentContainerStyle={styles.detailBody}>
                {detail}
              </ScrollView>
            </View>
          </>
        ) : open ? (
          <ScrollView style={styles.fill} contentContainerStyle={styles.narrowBody}>
            <Button title={`← ${backLabel}`} variant="link" onPress={onClose} />
            {detail}
          </ScrollView>
        ) : null}
      </View>
    </DetailContext.Provider>
  );
}

/** A detail's error: "<item> not found" with a way back for a missing item, otherwise the error and Try again. */
export function DetailError({
  error,
  onRetry,
  notFound,
  message = 'It may have been removed, or the link is wrong.',
}: {
  error: unknown;
  onRetry: () => void;
  /** e.g. "Chat not found". */
  notFound: string;
  message?: string;
}) {
  const context = useContext(DetailContext);
  if (isAxiosError(error) && error.response?.status === 404) {
    return (
      <EmptyState
        icon="search-outline"
        title={notFound}
        message={message}
        action={context ? { title: `Back to ${context.backLabel.toLowerCase()}`, onPress: context.close } : undefined}
      />
    );
  }
  return <ErrorState error={error} onRetry={onRetry} />;
}

// Collapsed or not, for every list screen, until the page is reloaded.
let collapsed = false;
const listeners = new Set<() => void>();
function setCollapsed(value: boolean) {
  collapsed = value;
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function RailView({ rail, selected }: { rail: Rail; selected: string | undefined }) {
  const isCollapsed = useSyncExternalStore(subscribe, () => collapsed);
  if (isCollapsed) {
    return (
      <View style={styles.strip}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show list"
          onPress={() => setCollapsed(false)}
          style={({ hovered }: PressState) => [styles.iconButton, hovered && styles.hovered]}
        >
          <Icon name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
      </View>
    );
  }
  const pages = rail.count === undefined ? 1 : Math.max(1, Math.ceil(rail.count / PAGE_SIZE));
  const page = rail.page ?? 1;
  return (
    <View style={styles.rail} role="navigation" aria-label={rail.title}>
      <View style={styles.railHeader}>
        <Text style={styles.railTitle} numberOfLines={1}>
          {rail.title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hide list"
          onPress={() => setCollapsed(true)}
          style={({ hovered }: PressState) => [styles.iconButton, hovered && styles.hovered]}
        >
          <Icon name="chevron-back" size={18} color={colors.muted} />
        </Pressable>
      </View>
      <ScrollView style={styles.fill}>
        {rail.items === undefined ? (
          <LoadingState />
        ) : (
          rail.items.map((item) => {
            const current = item.id === selected;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="link"
                accessibilityLabel={item.accessibilityLabel}
                aria-current={current}
                onPress={() => rail.onSelect(item.id)}
                style={({ hovered }: PressState) => [
                  styles.railRow,
                  hovered && styles.hovered,
                  current && styles.current,
                ]}
              >
                <Text style={[styles.primary, item.strong && styles.strong]} numberOfLines={1}>
                  {item.primary}
                </Text>
                <Text style={styles.secondary} numberOfLines={1}>
                  {item.secondary}
                </Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
      {pages > 1 && rail.onPage ? (
        <View style={styles.pager}>
          <PagerButton
            label="Previous page"
            icon="chevron-back"
            disabled={page <= 1}
            onPress={() => rail.onPage?.(page - 1)}
          />
          <Text style={styles.secondary}>
            Page {page} of {pages}
          </Text>
          <PagerButton
            label="Next page"
            icon="chevron-forward"
            disabled={page >= pages}
            onPress={() => rail.onPage?.(page + 1)}
          />
        </View>
      ) : null}
    </View>
  );
}

function PagerButton({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon: 'chevron-back' | 'chevron-forward';
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ hovered }: PressState) => [styles.iconButton, hovered && !disabled && styles.hovered]}
    >
      <Icon name={icon} size={16} color={disabled ? colors.light : colors.text} />
    </Pressable>
  );
}

/** Escape closes the open detail of the screen in view (web only). */
function useCloseOnEscape(open: boolean, onClose: () => void) {
  const focused = useIsFocused();
  useEffect(() => {
    if (Platform.OS !== 'web' || !open || !focused) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      // Escape in an open dialog or menu closes only that.
      if (event.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) {
        onClose();
      }
    };
    // Capture phase: text fields stop key events from bubbling.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, focused, onClose]);
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', backgroundColor: colors.background },
  fill: { flex: 1, minWidth: 0 },
  hidden: { display: 'none' },
  narrowBody: { padding: space.lg, gap: space.lg, backgroundColor: colors.background },
  rail: {
    width: RAIL_WIDTH,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  strip: {
    width: STRIP_WIDTH,
    alignItems: 'center',
    paddingTop: space.md,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  railHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  railTitle: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text, flexShrink: 1 },
  iconButton: { padding: space.xs, borderRadius: radius.sm },
  hovered: { backgroundColor: colors.background },
  railRow: {
    paddingVertical: space.sm,
    paddingLeft: space.lg - 3,
    paddingRight: space.md,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 2,
  },
  current: { backgroundColor: colors.primaryTint, borderLeftColor: colors.primary },
  primary: { fontSize: font.body, color: colors.text },
  strong: { fontWeight: weight.bold },
  secondary: { fontSize: font.small, color: colors.muted },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  detail: { backgroundColor: colors.background },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailTitle: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  close: { paddingHorizontal: space.sm, paddingVertical: space.xs },
  closeText: { fontSize: font.heading, color: colors.muted },
  detailBody: { padding: space.lg, gap: space.lg },
});
