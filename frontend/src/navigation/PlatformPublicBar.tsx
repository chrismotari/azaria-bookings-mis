import { useNavigation } from '@react-navigation/native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthContext';
import { PressState } from '../components/pressState';
import { colors, font, radius, space, useIsWide, weight } from '../theme';
import { APP_BAR_HEIGHT } from './AppBar';

/** The root host's public pages (home, sign-in): the brand, and Admin sign in or Open admin. */
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
          onPress={() =>
            user
              ? navigation.navigate('PlatformTabs', { screen: 'PlatformDashboard' })
              : navigation.navigate('PlatformLogin')
          }
          style={({ hovered }: PressState) => [styles.link, hovered && styles.linkHovered]}
        >
          <Text style={[styles.linkText, !isWide && styles.linkTextNarrow]}>
            {user ? 'Open admin' : 'Admin sign in'}
          </Text>
        </Pressable>
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
