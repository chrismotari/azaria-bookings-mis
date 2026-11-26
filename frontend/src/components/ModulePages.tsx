import { ReactNode, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { MODULE_LABELS, useModules } from '../agency/modules';
import { Module } from '../api/types';
import { colors, createStyles, font, radius, shadowRaised, space, useIsWide, weight } from '../theme';
import { Icon, IconName } from './Icon';
import { PressState } from './pressState';

export type ModuleTab = Module | 'all';

type Props = {
  label: string;
  pages: Record<Module, () => ReactNode>;
  only?: Module;
  /** A first tab, "All", the default, with more than one module. */
  all?: () => ReactNode;
  /** The tab, when the caller keeps it (e.g. in the URL). */
  tab?: ModuleTab;
  onTab?: (tab: ModuleTab) => void;
  /** Hides the switch while the page shows an item; the pages stay mounted. */
  hideSwitch?: boolean;
};

/** A page per module on, with a switch between them when there is more than one. */
export function ModulePages({ label, pages, only, all, tab, onTab, hideSwitch }: Props) {
  const modules = useModules();
  const [own, setOwn] = useState<ModuleTab | undefined>(undefined);
  const chosen = tab ?? own;
  const tabs: ModuleTab[] = all ? ['all', ...modules] : modules;
  const current = only ?? (chosen && tabs.includes(chosen) ? chosen : tabs[0]);
  if (only || modules.length < 2) {
    return <>{pages[only ?? modules[0]]()}</>;
  }
  return (
    <View style={styles.fill}>
      <View style={[styles.bar, hideSwitch && styles.hidden]}>
        <ModuleSwitch label={label} tabs={tabs} value={current} onChange={onTab ?? setOwn} />
      </View>
      <View style={styles.fill}>{current === 'all' && all ? all() : pages[current as Module]()}</View>
    </View>
  );
}

const ICONS: Record<ModuleTab, IconName> = {
  all: 'grid-outline',
  flights: 'airplane-outline',
  tours: 'map-outline',
  hotels: 'bed-outline',
};

type SwitchProps = { label: string; tabs: ModuleTab[]; value: ModuleTab; onChange: (tab: ModuleTab) => void };

function ModuleSwitch({ label, tabs, value, onChange }: SwitchProps) {
  const compact = !useIsWide();
  return (
    <View style={[styles.switch, compact && styles.switchCompact]} accessibilityRole="tablist" aria-label={label}>
      {tabs.map((tab) => {
        const selected = tab === value;
        return (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab)}
            style={({ hovered, focused }: PressState) => [
              styles.tab,
              compact && styles.tabCompact,
              hovered && !selected && styles.tabHovered,
              selected && styles.tabSelected,
              compact && styles.tabSelectedCompact,
              focused && styles.focused,
            ]}
          >
            <Icon name={ICONS[tab]} size={18} color={selected ? colors.primaryText : colors.muted} />
            <Text
              style={[styles.tabText, compact && styles.tabTextCompact, selected && styles.tabTextSelected]}
              numberOfLines={1}
            >
              {tab === 'all' ? 'All' : MODULE_LABELS[tab]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = createStyles(() => ({
  fill: { flex: 1 },
  hidden: { display: 'none' },
  bar: { backgroundColor: colors.background, paddingHorizontal: space.lg, paddingTop: space.lg },
  switch: {
    flexDirection: 'row',
    alignSelf: 'center',
    gap: space.xs,
    padding: space.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadowRaised,
  },
  switchCompact: { alignSelf: 'stretch', borderRadius: radius.lg },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
  },
  tabCompact: { flex: 1, minWidth: 0, flexDirection: 'column', gap: 2, paddingHorizontal: space.xs },
  tabHovered: { backgroundColor: colors.primaryTint },
  tabSelected: { backgroundColor: colors.primary },
  tabSelectedCompact: { borderRadius: radius.md },
  tabText: { fontSize: font.body, fontWeight: weight.bold, color: colors.muted },
  tabTextCompact: { fontSize: font.caption },
  tabTextSelected: { color: colors.primaryText },
  focused: { outlineColor: colors.primary, outlineStyle: 'solid', outlineWidth: 2, outlineOffset: 2 },
}));
