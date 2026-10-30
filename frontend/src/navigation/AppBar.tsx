import { useNavigation } from '@react-navigation/native';
import { ReactNode, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthContext';
import { useSignOut } from '../auth/useSignOut';
import { colors, radius, shadow, space, useIsWide } from '../theme';

export const APP_BAR_HEIGHT = 56;

/**
 * The brand bar: brand, optional navigation items, and the guest or account
 * controls. Full navigation on wide screens; brand and account only on narrow ones.
 */
export function AppBar({ children }: { children?: ReactNode }) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isWide = useIsWide();
  const goHome = () =>
    user?.role === 'admin'
      ? navigation.navigate('AdminTabs', { screen: 'AdminDashboard' })
      : navigation.navigate('Main', { screen: 'Explore' });

  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <View style={[styles.inner, !isWide && styles.innerNarrow]}>
        <Pressable accessibilityRole="link" onPress={goHome}>
          <Text style={[styles.brand, !isWide && styles.brandNarrow]} numberOfLines={1}>
            Azaria Bookings
          </Text>
        </Pressable>
        <View style={styles.items} accessibilityRole="tablist">
          {children}
        </View>
        {user ? <AccountMenu /> : <GuestActions />}
      </View>
    </View>
  );
}

/** A navigation item in the bar; the focused one is underlined in amber. */
export function AppBarItem({ label, focused, onPress }: { label: string; focused: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      style={[styles.item, focused && styles.itemFocused]}
    >
      <Text style={[styles.itemText, focused && styles.itemTextFocused]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function GuestActions() {
  const navigation = useNavigation();
  const isWide = useIsWide();
  return (
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Login')} style={styles.link}>
        <Text style={[styles.linkText, !isWide && styles.textNarrow]}>Sign in</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.navigate('Register')}
        style={[styles.cta, !isWide && styles.ctaNarrow]}
      >
        <Text style={[styles.ctaText, !isWide && styles.textNarrow]}>Create account</Text>
      </Pressable>
    </View>
  );
}

function AccountMenu() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Account menu"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={styles.account}
      >
        <Text style={styles.linkText} numberOfLines={1}>
          {user?.full_name} ▾
        </Text>
      </Pressable>
      <Modal transparent visible={open} onRequestClose={close} animationType="none">
        <Pressable accessibilityLabel="Close menu" style={styles.backdrop} onPress={close}>
          <View style={[styles.menu, { top: insets.top + APP_BAR_HEIGHT - space.xs }]}>
            <Text style={styles.menuEmail} numberOfLines={1}>
              {user?.email}
            </Text>
            {user?.role === 'customer' ? (
              <MenuItem
                label="Account"
                onPress={() => {
                  close();
                  navigation.navigate('Main', { screen: 'Account' });
                }}
              />
            ) : null}
            <MenuItem
              label="Sign out"
              onPress={() => {
                close();
                signOut();
              }}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function MenuItem({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="menuitem"
      onPress={onPress}
      style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
    >
      <Text style={styles.menuItemText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.primary },
  inner: {
    height: APP_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xl,
    paddingHorizontal: space.lg,
  },
  innerNarrow: { gap: space.sm, paddingHorizontal: space.md },
  brand: { fontSize: 18, fontWeight: '700', color: colors.primaryText },
  brandNarrow: { fontSize: 16 },
  textNarrow: { fontSize: 14 },
  items: { flex: 1, flexDirection: 'row', alignSelf: 'stretch', gap: space.xs, minWidth: 0 },
  item: {
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  itemFocused: { borderBottomColor: colors.accent },
  itemText: { fontSize: 15, color: colors.primaryText, opacity: 0.85 },
  itemTextFocused: { fontWeight: '700', opacity: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  link: { paddingHorizontal: space.xs, paddingVertical: space.sm },
  linkText: { color: colors.primaryText, fontWeight: '600', fontSize: 15 },
  cta: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  ctaNarrow: { paddingHorizontal: space.sm, paddingVertical: 6 },
  ctaText: { color: colors.accentText, fontWeight: '700', fontSize: 15 },
  account: { paddingVertical: space.sm, maxWidth: 220 },
  backdrop: { flex: 1 },
  menu: {
    position: 'absolute',
    right: space.lg,
    minWidth: 200,
    maxWidth: 280,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: space.xs,
    ...shadow,
  },
  menuEmail: {
    color: colors.muted,
    fontSize: 13,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuItem: { paddingHorizontal: space.lg, paddingVertical: 10 },
  menuItemPressed: { backgroundColor: colors.primaryTint },
  menuItemText: { color: colors.text, fontSize: 15 },
});
