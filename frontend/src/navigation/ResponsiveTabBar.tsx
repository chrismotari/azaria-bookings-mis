import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, useIsWide } from '../theme';

type Props = BottomTabBarProps & {
  /** Routes not offered in the bar (still reachable by URL). */
  hiddenRoutes?: string[];
};

/** Left sidebar on wide viewports, bottom tabs on narrow ones. */
export function ResponsiveTabBar({ state, descriptors, navigation, hiddenRoutes = [] }: Props) {
  const isWide = useIsWide();
  const insets = useSafeAreaInsets();

  const items = state.routes.map((route, index) => {
    if (hiddenRoutes.includes(route.name)) {
      return null;
    }
    const { options } = descriptors[route.key];
    const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name);
    const focused = state.index === index;
    const onPress = () => {
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) {
        navigation.navigate(route.name, route.params);
      }
    };
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        onPress={onPress}
        style={[isWide ? styles.sideItem : styles.bottomItem, focused && styles.focused]}
      >
        <Text style={[styles.label, focused && styles.focusedLabel]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    );
  });

  if (isWide) {
    return (
      <View style={[styles.sidebar, { paddingTop: insets.top + 20 }]}>
        <Text style={styles.brand}>Azaria Bookings</Text>
        {items}
      </View>
    );
  }
  return <View style={[styles.bottomBar, { paddingBottom: insets.bottom }]}>{items}</View>;
}

const styles = StyleSheet.create({
  sidebar: {
    width: 220,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    gap: 4,
  },
  brand: { fontSize: 18, fontWeight: '700', color: colors.primary, marginBottom: 16, paddingHorizontal: 12 },
  sideItem: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 6 },
  bottomBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  bottomItem: { flex: 1, paddingVertical: 14, alignItems: 'center', minWidth: 0 },
  focused: { backgroundColor: colors.primaryTint },
  label: { fontSize: 15, color: colors.text },
  focusedLabel: { color: colors.primary, fontWeight: '700' },
});
