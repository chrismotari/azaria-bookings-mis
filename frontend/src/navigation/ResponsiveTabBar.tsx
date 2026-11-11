import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { ReactNode, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../components/Icon';
import { PressState } from '../components/pressState';
import { colors, font, radius, shadow, space, useIsWide, weight } from '../theme';
import { AppBar, AppBarItem } from './AppBar';

type Props = BottomTabBarProps & {
  /** Routes not offered in the bar (still reachable by URL). */
  hiddenRoutes?: string[];
  /** Hidden route -> the tab that stays highlighted on it, e.g. Billing -> Settings. */
  parentRoutes?: Record<string, string>;
  /** On narrow screens with more than five tabs, the four kept in the bar; the rest go under More. */
  narrowTabs?: string[];
};

type TabItem = {
  key: string;
  name: string;
  label: string;
  focused: boolean;
  onPress: () => void;
  icon: (color: string) => ReactNode;
  badge?: string | number;
};

const MAX_NARROW_TABS = 5;

export function ResponsiveTabBar({
  state,
  descriptors,
  navigation,
  hiddenRoutes = [],
  parentRoutes = {},
  narrowTabs,
}: Props) {
  const isWide = useIsWide();
  const insets = useSafeAreaInsets();
  const [moreOpen, setMoreOpen] = useState(false);
  const [barHeight, setBarHeight] = useState(0);

  const routes = state.routes.flatMap((route, index): TabItem[] => {
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
    const badge = options.tabBarBadge;
    return [{ key: route.key, name: route.name, label, focused, onPress, icon, badge }];
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
            badge={route.badge}
          />
        ))}
      </AppBar>
    );
  }

  const overflowing = routes.length > MAX_NARROW_TABS;
  const kept = overflowing
    ? narrowTabs
      ? routes.filter((route) => narrowTabs.includes(route.name))
      : routes.slice(0, MAX_NARROW_TABS - 1)
    : routes;
  const more = overflowing ? routes.filter((route) => !kept.includes(route)) : [];
  const moreItem: TabItem | null = more.length
    ? {
        key: 'more',
        name: 'More',
        label: 'More',
        focused: more.some((route) => route.focused),
        onPress: () => setMoreOpen(true),
        icon: (color) => <Icon name="ellipsis-horizontal" size={22} color={color} />,
        badge: combinedBadge(more),
      }
    : null;

  return (
    <View
      style={[styles.bottomBar, { paddingBottom: insets.bottom }]}
      onLayout={(event) => setBarHeight(event.nativeEvent.layout.height)}
    >
      {[...kept, ...(moreItem ? [moreItem] : [])].map((route) => (
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
          <View>
            {route.icon(route.focused ? colors.primary : colors.muted)}
            {route.badge ? <TabBadge value={route.badge} /> : null}
          </View>
          <Text style={[styles.label, route.focused && styles.focusedLabel]} numberOfLines={1}>
            {route.label}
          </Text>
        </Pressable>
      ))}
      <Modal transparent visible={moreOpen} onRequestClose={() => setMoreOpen(false)} animationType="none">
        <Pressable accessibilityLabel="Close menu" style={styles.backdrop} onPress={() => setMoreOpen(false)}>
          <View accessibilityRole="menu" style={[styles.moreMenu, { bottom: barHeight + space.xs }]}>
            {more.map((route) => (
              <Pressable
                key={route.key}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: route.focused }}
                onPress={() => {
                  setMoreOpen(false);
                  route.onPress();
                }}
                style={({ pressed, hovered }: PressState) => [
                  styles.moreItem,
                  (pressed || hovered) && styles.moreItemPressed,
                ]}
              >
                {route.icon(route.focused ? colors.primary : colors.text)}
                <Text style={[styles.moreLabel, route.focused && styles.focusedLabel]}>{route.label}</Text>
                {route.badge ? (
                  <View style={styles.inlineBadge} accessibilityLabel={`${route.badge} unread`}>
                    <Text style={styles.badgeText}>{route.badge}</Text>
                  </View>
                ) : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

/** The tabs under More share one badge: their counts added up, capped like a single tab's. */
function combinedBadge(routes: TabItem[]): string | number | undefined {
  const badges = routes.map((route) => route.badge).filter((badge) => badge !== undefined && badge !== '');
  if (!badges.length) {
    return undefined;
  }
  const total = badges.reduce<number>((sum, badge) => sum + (typeof badge === 'number' ? badge : 10), 0);
  return total > 9 ? '9+' : total;
}

function TabBadge({ value }: { value: string | number }) {
  return (
    <View style={styles.badge} accessibilityLabel={`${value} unread`}>
      <Text style={styles.badgeText}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.accentText, fontSize: font.caption, fontWeight: weight.bold },
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
  backdrop: { flex: 1 },
  moreMenu: {
    position: 'absolute',
    right: space.sm,
    minWidth: 200,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: space.xs,
    ...shadow,
  },
  moreItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
  },
  moreItemPressed: { backgroundColor: colors.primaryTint },
  moreLabel: { flex: 1, color: colors.text, fontSize: font.body },
  inlineBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focused: { borderTopColor: colors.primary },
  label: { fontSize: font.caption, color: colors.muted },
  focusedLabel: { color: colors.primary, fontWeight: weight.bold },
});
