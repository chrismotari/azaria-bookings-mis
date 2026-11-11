import { useNavigation } from '@react-navigation/native';
import { ReactNode, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthContext';
import { useSignOut } from '../auth/useSignOut';
import { IS_PLATFORM } from '../config';
import { Icon, IconName } from '../components/Icon';
import { colors, font, radius, shadow, space, useIsWide, weight } from '../theme';
import { PressState } from '../components/pressState';

export const APP_BAR_HEIGHT = 56;

/** brandOnly drops the account controls, for the auth screens where they would repeat the form. */
export function AppBar({ children, brandOnly }: { children?: ReactNode; brandOnly?: boolean }) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isWide = useIsWide();
  const goHome = () => {
    if (IS_PLATFORM) {
      if (user) {
        navigation.navigate('PlatformTabs', { screen: 'PlatformDashboard' });
      } else {
        navigation.navigate('PlatformHome');
      }
    } else if (user?.role === 'admin') {
      navigation.navigate('AdminTabs', { screen: 'AdminDashboard' });
    } else {
      navigation.navigate('Main', { screen: 'Explore' });
    }
  };

  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <View style={[styles.inner, !isWide && styles.innerNarrow]}>
        <Pressable accessibilityRole="link" onPress={goHome}>
          <Text style={[styles.brand, !isWide && styles.brandNarrow]} numberOfLines={1}>
            Azaria Bookings
            {IS_PLATFORM ? <Text style={styles.brandTag}> Platform</Text> : null}
          </Text>
        </Pressable>
        <View style={styles.items} accessibilityRole="tablist">
          {children}
        </View>
        {brandOnly ? null : user ? <AccountMenu /> : <GuestActions />}
      </View>
    </View>
  );
}

type ItemProps = { label: string; icon: ReactNode; focused: boolean; onPress: () => void; badge?: string | number };

export function AppBarItem({ label, icon, focused, onPress, badge }: ItemProps) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      style={({ hovered }: PressState) => [styles.item, hovered && styles.itemHovered, focused && styles.itemFocused]}
    >
      {icon}
      <Text style={[styles.itemText, focused && styles.itemTextFocused]} numberOfLines={1}>
        {label}
      </Text>
      {badge ? (
        <View style={styles.itemBadge} accessibilityLabel={`${badge} unread`}>
          <Text style={styles.itemBadgeText}>{badge}</Text>
        </View>
      ) : null}
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
  const isWide = useIsWide();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Account menu"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ hovered }: PressState) => [styles.account, hovered && styles.accountHovered]}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(user?.full_name ?? '')}</Text>
        </View>
        {isWide ? (
          <Text style={[styles.linkText, styles.shrink]} numberOfLines={1}>
            {user?.full_name}
          </Text>
        ) : null}
        <Icon name="chevron-down" size={16} color={colors.primaryText} />
      </Pressable>
      <Modal transparent visible={open} onRequestClose={close} animationType="none">
        <Pressable accessibilityLabel="Close menu" style={styles.backdrop} onPress={close}>
          <View style={[styles.menu, { top: insets.top + APP_BAR_HEIGHT - space.xs }]}>
            <Text style={styles.menuEmail} numberOfLines={1}>
              {user?.email}
            </Text>
            {user?.role === 'customer' ? (
              <>
                <MenuItem
                  label="Account"
                  icon="person-circle-outline"
                  onPress={() => {
                    close();
                    navigation.navigate('Main', { screen: 'Account' });
                  }}
                />
                <MenuItem
                  label="Support"
                  icon="chatbubbles-outline"
                  onPress={() => {
                    close();
                    navigation.navigate('Main', { screen: 'Support' });
                  }}
                />
              </>
            ) : null}
            <MenuItem
              label="Sign out"
              icon="log-out-outline"
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

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return '?';
  }
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function MenuItem({ label, icon, onPress }: { label: string; icon: IconName; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="menuitem"
      onPress={onPress}
      style={({ pressed, hovered }: PressState) => [styles.menuItem, (pressed || hovered) && styles.menuItemPressed]}
    >
      <Icon name={icon} size={18} color={colors.muted} />
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
  brand: { fontSize: font.heading, fontWeight: weight.bold, color: colors.primaryText },
  brandNarrow: { fontSize: font.body },
  brandTag: { fontWeight: weight.regular, opacity: 0.8 },
  textNarrow: { fontSize: font.small },
  items: { flex: 1, flexDirection: 'row', alignSelf: 'stretch', gap: space.xs, minWidth: 0 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  itemHovered: { backgroundColor: colors.primaryHover },
  itemFocused: { borderBottomColor: colors.accent },
  itemText: { fontSize: font.body, color: colors.primaryText, opacity: 0.85 },
  itemTextFocused: { fontWeight: weight.bold, opacity: 1 },
  itemBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemBadgeText: { color: colors.accentText, fontSize: font.caption, fontWeight: weight.bold },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  link: { paddingHorizontal: space.xs, paddingVertical: space.sm },
  linkText: { color: colors.primaryText, fontWeight: weight.semibold, fontSize: font.body },
  cta: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  ctaNarrow: { paddingHorizontal: space.sm, paddingVertical: 6 },
  ctaText: { color: colors.accentText, fontWeight: weight.bold, fontSize: font.body },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    maxWidth: 260,
  },
  accountHovered: { backgroundColor: colors.primaryHover },
  shrink: { flexShrink: 1 },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.accentText, fontWeight: weight.bold, fontSize: font.small },
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
    fontSize: font.small,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10 },
  menuItemPressed: { backgroundColor: colors.primaryTint },
  menuItemText: { color: colors.text, fontSize: font.body },
});
