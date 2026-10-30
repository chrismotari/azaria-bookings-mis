import { useIsFocused } from '@react-navigation/native';
import { ReactNode, useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, space, useIsWide } from '../theme';
import { Button } from './Button';

export const PANEL_WIDTH = 480;

type Props = {
  /** The list screen; it stays mounted (filters, page, scroll) while a detail is open. */
  list: ReactNode;
  /** The selected item's detail, or null when nothing is selected. */
  detail: ReactNode | null;
  /** Panel heading on wide screens, e.g. "Booking". */
  title: string;
  /** Back link on narrow screens, e.g. "All bookings". */
  backLabel: string;
  onClose: () => void;
};

/**
 * List with its selected item's detail. Wide: the detail is a panel on the right
 * and the list narrows beside it. Narrow: the detail takes the whole screen.
 */
export function DetailLayout({ list, detail, title, backLabel, onClose }: Props) {
  const isWide = useIsWide();
  const open = detail !== null;
  useCloseOnEscape(open, onClose);

  if (isWide) {
    return (
      <View style={styles.row}>
        <View style={styles.fill}>{list}</View>
        {open ? (
          <Panel title={title} onClose={onClose}>
            {detail}
          </Panel>
        ) : null}
      </View>
    );
  }
  return (
    <View style={styles.fill}>
      <View style={[styles.fill, open && styles.hidden]}>{list}</View>
      {open ? (
        <ScrollView style={styles.fill} contentContainerStyle={styles.narrowBody}>
          <Button title={`← ${backLabel}`} variant="link" onPress={onClose} />
          {detail}
        </ScrollView>
      ) : null}
    </View>
  );
}

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  // Slides in when it opens; switching to another item keeps it in place.
  const offset = useRef(new Animated.Value(PANEL_WIDTH)).current;
  useEffect(() => {
    Animated.timing(offset, { toValue: 0, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [offset]);

  return (
    <Animated.View style={[styles.panel, { transform: [{ translateX: offset }] }]} aria-label={title}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>{title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.fill} contentContainerStyle={styles.panelBody}>
        {children}
      </ScrollView>
    </Animated.View>
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
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, focused, onClose]);
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  fill: { flex: 1, minWidth: 0 },
  hidden: { display: 'none' },
  narrowBody: { padding: space.lg, gap: space.lg, backgroundColor: colors.background },
  panel: {
    width: PANEL_WIDTH,
    maxWidth: '50%',
    backgroundColor: colors.background,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    boxShadow: '-4px 0 12px rgba(37, 37, 37, 0.08)',
  },
  panelHeader: {
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
  panelTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  close: { paddingHorizontal: space.sm, paddingVertical: space.xs },
  closeText: { fontSize: 18, color: colors.muted },
  panelBody: { padding: space.lg, gap: space.lg },
});
