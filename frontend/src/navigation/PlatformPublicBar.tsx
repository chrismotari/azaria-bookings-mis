import { useNavigation } from '@react-navigation/native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthContext';
import { PressState } from '../components/pressState';
import { colors, font, radius, space, useIsWide, weight } from '../theme';
import { APP_BAR_HEIGHT } from './AppBar';

/** The root host's public pages (home, pricing, sign-in): the brand, Pricing, and Open admin for the signed-in owner. */
export function PlatformPublicBar() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isWide = useIsWide();
  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <View style={[styles.inner, !isWide && styles.innerNarrow]}>
        <Pressable accessibilityRole="link" onPress={() => navigation.navigate('PlatformHome')}>
          <Text style={[styles.brand, !isWide && styles.brandNarrow]} numberOfLines={1}>
            Azaria Bookings
          </Text>
        </Pressable>
        <View style={styles.fill} />
        <Pressable
          accessibilityRole="link"
          onPress={() => navigation.navigate('PlatformPricing')}
          style={({ hovered }: PressState) => [styles.link, hovered && styles.linkHovered]}
        >
          <Text style={[styles.linkText, !isWide && styles.linkTextNarrow]}>Pricing</Text>
        </Pressable>
        {/* No sign-in link: the owner goes to /login directly. Signed in, the way back to the admin. */}
        {user ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => navigation.navigate('PlatformTabs', { screen: 'PlatformDashboard' })}
            style={({ hovered }: PressState) => [styles.link, hovered && styles.linkHovered]}
          >
            <Text style={[styles.linkText, !isWide && styles.linkTextNarrow]}>Open admin</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
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
  fill: { flex: 1 },
  link: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.sm },
  linkHovered: { backgroundColor: colors.primaryHover },
  linkText: { color: colors.primaryText, fontWeight: weight.semibold, fontSize: font.body },
  linkTextNarrow: { fontSize: font.small },
});
