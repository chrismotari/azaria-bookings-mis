import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, useIsWide } from '../theme';
import { AppBar, AppBarItem } from './AppBar';

type Props = BottomTabBarProps & {
  /** Routes not offered in the bar (still reachable by URL). */
  hiddenRoutes?: string[];
};

/** The brand bar with navigation on wide viewports, bottom tabs on narrow ones. */
export function ResponsiveTabBar({ state, descriptors, navigation, hiddenRoutes = [] }: Props) {
  const isWide = useIsWide();
  const insets = useSafeAreaInsets();

  const routes = state.routes.flatMap((route, index) => {
    if (hiddenRoutes.includes(route.name)) {
      return [];
    }
    const { options } = descriptors[route.key];
    const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name);
    const focused = state.index === index;
    const onPress = () => {
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (event.defaultPrevented) {
        return;
      }
      if (!focused) {
        navigation.navigate(route.name, route.params);
      } else if (route.params && 'id' in route.params) {
        // Pressing the current tab again closes its open detail.
        navigation.navigate(route.name, { ...route.params, id: undefined });
      }
    };
    return [{ key: route.key, label, focused, onPress }];
  });

  if (isWide) {
    return (
      <AppBar>
        {routes.map((route) => (
          <AppBarItem key={route.key} label={route.label} focused={route.focused} onPress={route.onPress} />
        ))}
      </AppBar>
    );
  }
  return (
    <View style={[styles.bottomBar, { paddingBottom: insets.bottom }]}>
      {routes.map((route) => (
        <Pressable
          key={route.key}
          accessibilityRole="tab"
          accessibilityState={{ selected: route.focused }}
          onPress={route.onPress}
          style={[styles.bottomItem, route.focused && styles.focused]}
        >
          <Text style={[styles.label, route.focused && styles.focusedLabel]} numberOfLines={1}>
            {route.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bottomBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  bottomItem: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 2,
    alignItems: 'center',
    minWidth: 0,
    borderTopWidth: 3,
    borderTopColor: 'transparent',
  },
  focused: { backgroundColor: colors.primaryTint, borderTopColor: colors.primary },
  label: { fontSize: 14, color: colors.text },
  focusedLabel: { color: colors.primary, fontWeight: '700' },
});
