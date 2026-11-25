import { ReactNode, useState } from 'react';
import { View } from 'react-native';

import { MODULE_LABELS, useModules } from '../agency/modules';
import { Module } from '../api/types';
import { colors, createStyles, space } from '../theme';
import { SegmentedControl } from './SegmentedControl';

type Props = {
  label: string;
  pages: Record<Module, () => ReactNode>;
  only?: Module;
};

/** A page per module on, with a switch between them when there is more than one. */
export function ModulePages({ label, pages, only }: Props) {
  const modules = useModules();
  const [chosen, setChosen] = useState<Module>(modules[0]);
  const current = only ?? (modules.includes(chosen) ? chosen : modules[0]);
  if (only || modules.length < 2) {
    return <>{pages[current]()}</>;
  }
  return (
    <View style={styles.fill}>
      <View style={styles.bar}>
        <View style={styles.switch}>
          <SegmentedControl
            label={label}
            options={modules.map((module) => ({ value: module, label: MODULE_LABELS[module] }))}
            value={current}
            onChange={setChosen}
          />
        </View>
      </View>
      <View style={styles.fill}>{pages[current]()}</View>
    </View>
  );
}

const styles = createStyles(() => ({
  fill: { flex: 1 },
  bar: { backgroundColor: colors.background, paddingHorizontal: space.lg, paddingTop: space.lg },
  switch: { width: '100%', maxWidth: 480, alignSelf: 'center' },
}));
