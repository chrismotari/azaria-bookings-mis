import { StackActions, useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { PressState } from '../components/pressState';
import {
  getStarted,
  scrollToSection,
  scrollToTop,
  SECTION_LINKS,
  SectionId,
  setPendingSection,
} from '../screens/platform/site';
import { colors, createStyles, font, radius, shadowDialog, space, useIsWide, weight } from '../theme';

export const SITE_BAR_HEIGHT = 68;

/** The website's bar on the root host's public pages; `route` is the page it sits on. */
export function PlatformPublicBar({ route }: { route: string }) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isWide = useIsWide();
  const [menuOpen, setMenuOpen] = useState(false);
  const onHome = route === 'PlatformHome';

  const goHome = () => {
    setMenuOpen(false);
    if (onHome) {
      scrollToTop();
    } else {
      navigation.dispatch(StackActions.popTo('PlatformHome'));
    }
  };
  const goSection = (id: SectionId) => {
    setMenuOpen(false);
    if (onHome) {
      scrollToSection(id);
    } else {
      setPendingSection(id);
      navigation.dispatch(StackActions.popTo('PlatformHome'));
    }
  };
  const goPricing = () => {
    setMenuOpen(false);
    navigation.navigate('PlatformPricing');
  };
  // Deliberately no sign-in link: the owner goes to /login directly.
  const action = user ? (
    <Button
      title="Open admin"
      variant="primary"
      icon={isWide ? 'grid-outline' : undefined}
      onPress={() => navigation.navigate('PlatformTabs', { screen: 'PlatformDashboard' })}
    />
  ) : (
    <Button title="Get started" variant="accent" onPress={getStarted} />
  );
  const links = [
    ...SECTION_LINKS.map((link) => ({ key: link.id, label: link.label, onPress: () => goSection(link.id) })),
    { key: 'pricing', label: 'Pricing', onPress: goPricing, current: route === 'PlatformPricing' },
  ];

  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <View style={[styles.inner, !isWide && styles.innerNarrow]}>
        <Pressable accessibilityRole="link" accessibilityLabel="Azaria Bookings, home" onPress={goHome}>
          <Brand />
        </Pressable>
        <View style={styles.fill} />
        {isWide ? (
          <View style={styles.links} role="navigation" aria-label="Website">
            {links.map((link) => (
              <Pressable
                key={link.key}
                accessibilityRole="link"
                aria-current={'current' in link && link.current ? 'page' : undefined}
                onPress={link.onPress}
                style={({ hovered }: PressState) => [styles.link, hovered && styles.linkHovered]}
              >
                <Text style={[styles.linkText, 'current' in link && link.current ? styles.linkCurrent : null]}>
                  {link.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {action}
        {isWide ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Menu"
            aria-expanded={menuOpen}
            onPress={() => setMenuOpen(true)}
            style={({ hovered }: PressState) => [styles.menuButton, hovered && styles.linkHovered]}
          >
            <Icon name="menu" size={26} color={colors.text} />
          </Pressable>
        )}
      </View>
      <Modal visible={menuOpen && !isWide} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} accessible={false} />
          <View style={[styles.sheet, { paddingTop: insets.top }]} role="dialog" aria-label="Menu">
            <View style={[styles.inner, styles.innerNarrow]}>
              <Brand />
              <View style={styles.fill} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close menu"
                onPress={() => setMenuOpen(false)}
                style={({ hovered }: PressState) => [styles.menuButton, hovered && styles.linkHovered]}
              >
                <Icon name="close" size={26} color={colors.text} />
              </Pressable>
            </View>
            <View style={styles.sheetLinks} role="navigation" aria-label="Website">
              {links.map((link) => (
                <Pressable
                  key={link.key}
                  accessibilityRole="link"
                  onPress={link.onPress}
                  style={({ hovered }: PressState) => [styles.sheetLink, hovered && styles.linkHovered]}
                >
                  <Text style={styles.sheetLinkText}>{link.label}</Text>
                  <Icon name="chevron-forward" size={18} color={colors.muted} />
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** The website's logo: a mark drawn in the brand colours, and the name. */
export function Brand({ inverse }: { inverse?: boolean }) {
  return (
    <View style={styles.brand}>
      <View style={[styles.mark, inverse && styles.markInverse]}>
        <Icon name="paper-plane" size={17} color={inverse ? colors.primary : colors.primaryText} />
      </View>
      <Text style={[styles.brandText, inverse && styles.brandTextInverse]} numberOfLines={1}>
        Azaria Bookings
      </Text>
    </View>
  );
}

const styles = createStyles(() => ({
  bar: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  inner: {
    height: SITE_BAR_HEIGHT,
    width: '100%',
    maxWidth: 1200 + 2 * space.xl,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: space.xl,
  },
  innerNarrow: { height: 60, gap: space.sm, paddingHorizontal: space.lg },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  mark: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markInverse: { backgroundColor: colors.surface },
  brandText: { fontSize: font.heading, fontWeight: weight.heavy, color: colors.text },
  brandTextInverse: { color: colors.primaryText },
  fill: { flex: 1 },
  links: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  link: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.sm },
  linkHovered: { backgroundColor: colors.background },
  linkText: { color: colors.dark, fontWeight: weight.semibold, fontSize: font.body },
  linkCurrent: { color: colors.primary },
  menuButton: { padding: space.sm, borderRadius: radius.sm },
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    paddingBottom: space.lg,
    ...shadowDialog,
  },
  sheetLinks: { paddingHorizontal: space.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm },
  sheetLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingVertical: space.md + 2,
    borderRadius: radius.md,
  },
  sheetLinkText: { fontSize: font.heading, fontWeight: weight.semibold, color: colors.text },
}));
