import { ReactNode, useState } from 'react';
import { View } from 'react-native';

import { MODULE_LABELS, useModules } from '../agency/modules';
import { Module } from '../api/types';
import { colors, createStyles, space } from '../theme';
import { SegmentedControl } from './SegmentedControl';

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
        <View style={styles.switch}>
          <SegmentedControl
            label={label}
            options={tabs.map((value) => ({ value, label: value === 'all' ? 'All' : MODULE_LABELS[value] }))}
            value={current}
            onChange={onTab ?? setOwn}
          />
        </View>
      </View>
      <View style={styles.fill}>{current === 'all' && all ? all() : pages[current as Module]()}</View>
    </View>
  );
}

const styles = createStyles(() => ({
  fill: { flex: 1 },
  hidden: { display: 'none' },
  bar: { backgroundColor: colors.background, paddingHorizontal: space.lg, paddingTop: space.lg },
  switch: { width: '100%', maxWidth: 480, alignSelf: 'center' },
}));
