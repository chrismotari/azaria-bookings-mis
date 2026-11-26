import { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { colors, createStyles, font, radius, space, useIsWide, weight } from '../theme';
import { BackLink } from './BackLink';
import { Icon, IconName } from './Icon';
import { PressState } from './pressState';

export type SettingsSectionItem<K extends string> = { key: K; label: string; icon: IconName };

type Props<K extends string> = {
  sections: SettingsSectionItem<K>[];
  /** The section in the URL, if any; wide screens fall back to the first. */
  current: K | undefined;
  onOpen: (section: K | undefined) => void;
  renderSection: (section: K) => ReactNode;
};

/** Settings in sections: a 220 px list beside the section on wide screens; on phones the list, then each section. */
export function SettingsLayout<K extends string>({ sections, current, onOpen, renderSection }: Props<K>) {
  const isWide = useIsWide();
  const known = sections.find((item) => item.key === current)?.key;

  if (!isWide) {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.narrow}>
        {known ? (
          <>
            <BackLink label="Settings" onPress={() => onOpen(undefined)} />
            {renderSection(known)}
          </>
        ) : (
          <>
            <Text style={styles.title}>Settings</Text>
            <SectionList sections={sections} onOpen={onOpen} />
          </>
        )}
      </ScrollView>
    );
  }
  const shown = known ?? sections[0].key;
  return (
    <View style={styles.wide}>
      <View style={styles.side}>
        <Text style={styles.title}>Settings</Text>
        <SectionList sections={sections} current={shown} onOpen={onOpen} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {renderSection(shown)}
      </ScrollView>
    </View>
  );
}

function SectionList<K extends string>({
  sections,
  current,
  onOpen,
}: {
  sections: SettingsSectionItem<K>[];
  current?: K;
  onOpen: (section: K) => void;
}) {
  return (
    <View style={styles.list} accessibilityRole="tablist">
      {sections.map((item) => {
        const selected = item.key === current;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onOpen(item.key)}
          >
            {(state: PressState) => (
              <View style={[styles.row, (state.hovered || state.pressed) && styles.rowHover, selected && styles.rowOn]}>
                <Icon name={item.icon} size={18} color={selected ? colors.primary : colors.muted} />
                <Text style={[styles.rowText, selected && styles.rowTextOn]}>{item.label}</Text>
                {current === undefined ? <Icon name="chevron-forward" size={16} color={colors.muted} /> : null}
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = createStyles(() => ({
  scroll: { flex: 1, backgroundColor: colors.background },
  narrow: { padding: space.lg, gap: space.lg },
  wide: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  side: {
    width: 220,
    padding: space.lg,
    gap: space.md,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    backgroundColor: colors.surface,
  },
  content: { padding: space.lg, gap: space.lg, width: '100%', maxWidth: 760 + 2 * space.lg },
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  list: { gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
  },
  rowHover: { backgroundColor: colors.background },
  rowOn: { backgroundColor: colors.primaryTint },
  rowText: { flex: 1, fontSize: font.body, color: colors.text },
  rowTextOn: { color: colors.primary, fontWeight: weight.semibold },
}));
