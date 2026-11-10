import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressState } from '../components/pressState';
import { colors, font, space, useIsWide, weight } from '../theme';
import { AppBar, AppBarItem } from './AppBar';

type Props = BottomTabBarProps & {
  /** Routes not offered in the bar (still reachable by URL). */
  hiddenRoutes?: string[];
  /** Hidden routes shown as part of a tab, e.g. Billing under Settings: that tab stays highlighted on them. */
  parentRoutes?: Record<string, string>;
};

/** The brand bar with navigation on wide viewports, bottom tabs on narrow ones. */
export function ResponsiveTabBar({ state, descriptors, navigation, hiddenRoutes = [], parentRoutes = {} }: Props) {
  const isWide = useIsWide();
  const insets = useSafeAreaInsets();

  const routes = state.routes.flatMap((route, index) => {
    if (hiddenRoutes.includes(route.name)) {
      return [];
    }
    const { options } = descriptors[route.key];
    const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name);
    const current = state.routes[state.index].name;
    const focused = state.index === index || parentRoutes[current] === route.name;
    // The bar draws icons in its own colours: light on the brand bar, indigo or text below.
    const icon = (color: string): ReactNode => options.tabBarIcon?.({ focused, color, size: isWide ? 18 : 22 });
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
    return [{ key: route.key, label, focused, onPress, icon }];
  });

  if (isWide) {
    return (
      <AppBar>
        {routes.map((route) => (
          <AppBarItem
            key={route.key}
            label={route.label}
            icon={route.icon(colors.primaryText)}
            focused={route.focused}
            onPress={route.onPress}
          />
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
          style={({ hovered }: PressState) => [
            styles.bottomItem,
            hovered && styles.hovered,
            route.focused && styles.focused,
          ]}
        >
          {route.icon(route.focused ? colors.primary : colors.muted)}
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
    paddingTop: space.sm,
    paddingBottom: 6,
    gap: 2,
    paddingHorizontal: 2,
    alignItems: 'center',
    minWidth: 0,
    borderTopWidth: 3,
    borderTopColor: 'transparent',
  },
  hovered: { backgroundColor: colors.background },
  focused: { borderTopColor: colors.primary },
  label: { fontSize: font.caption, color: colors.muted },
  focusedLabel: { color: colors.primary, fontWeight: weight.bold },
});
