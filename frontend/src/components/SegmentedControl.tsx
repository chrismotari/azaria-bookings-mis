import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, space, weight } from '../theme';
import { PressState } from './pressState';

type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  /** Read by screen readers; not shown. */
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Lets the segments wrap onto more rows (many options, e.g. status filters). */
  wrap?: boolean;
};

export function SegmentedControl<T extends string>({ label, options, value, onChange, wrap }: Props<T>) {
  return (
    <View style={[styles.track, wrap && styles.wrap]} accessibilityRole="radiogroup" aria-label={label}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.value)}
            style={({ hovered, focused }: PressState) => [
              styles.segment,
              wrap && styles.segmentWrap,
              hovered && !selected && styles.hovered,
              selected && styles.selected,
              focused && styles.focused,
            ]}
          >
            <Text style={[styles.text, selected && styles.selectedText]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: 3,
    gap: 3,
    borderRadius: radius.md,
    backgroundColor: colors.neutralTint,
  },
  // Sized by label so the longest one keeps to a single line on a phone.
  segment: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.sm,
    paddingHorizontal: space.xs,
    borderRadius: radius.sm,
  },
  wrap: { flexWrap: 'wrap', alignSelf: 'flex-start' },
  segmentWrap: { flexGrow: 0, paddingHorizontal: space.md },
  hovered: { backgroundColor: colors.surface },
  selected: { backgroundColor: colors.primary },
  focused: { outlineColor: colors.primary, outlineStyle: 'solid', outlineWidth: 2, outlineOffset: 2 },
  text: { fontSize: font.small, fontWeight: weight.semibold, color: colors.text, textAlign: 'center' },
  selectedText: { color: colors.primaryText },
});
