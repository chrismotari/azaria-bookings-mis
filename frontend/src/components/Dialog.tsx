import { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, shadowDialog, space, useIsWide, weight } from '../theme';
import { Icon } from './Icon';

type Props = {
  open: boolean;
  title: string;
  /** Escape, the close button and a click on the dimmed page call this, unless busy. */
  onClose: () => void;
  /** Small for confirmations, large for forms. */
  size?: 'small' | 'large';
  /** While saving, the dialog cannot be closed. */
  busy?: boolean;
  /** The action buttons, shown in the footer. */
  footer: ReactNode;
  /** Why the last action failed, shown in the footer above the buttons so it is in view. */
  error?: string | null;
  children: ReactNode;
};

/**
 * A modal card over a dimmed page; full screen on narrow screens. On web the modal
 * keeps keyboard focus inside and returns it to where it was when it closes.
 */
export function Dialog({ open, title, onClose, size = 'small', busy, footer, error, children }: Props) {
  const isWide = useIsWide();
  const close = () => {
    if (!busy) {
      onClose();
    }
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <View style={[styles.backdrop, !isWide && styles.backdropNarrow]}>
        {/* The dimmed page: clicking it closes the dialog. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessible={false} />
        <View
          style={[styles.card, size === 'large' ? styles.large : styles.small, !isWide && styles.cardNarrow]}
          aria-label={title}
        >
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={close}
              disabled={busy}
              style={styles.close}
            >
              <Icon name="close" size={22} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView style={[styles.scroll, !isWide && styles.scrollNarrow]} contentContainerStyle={styles.body}>
            {children}
          </ScrollView>
          <View style={styles.footer}>
            {error ? (
              <Text style={styles.error} role="alert">
                {error}
              </Text>
            ) : null}
            {footer}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
    backgroundColor: colors.overlay,
  },
  backdropNarrow: { padding: 0 },
  card: {
    width: '100%',
    maxHeight: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadowDialog,
  },
  small: { maxWidth: 440 },
  large: { maxWidth: 760 },
  cardNarrow: { maxWidth: '100%', height: '100%', borderRadius: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { flexShrink: 1, fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  close: { padding: space.xs },
  scroll: { flexGrow: 0, flexShrink: 1 },
  // Full screen: the body takes the free height so the buttons sit at the bottom.
  scrollNarrow: { flexGrow: 1 },
  body: { padding: space.lg, gap: space.md },
  error: { width: '100%', color: colors.dangerText, fontSize: font.small },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});
