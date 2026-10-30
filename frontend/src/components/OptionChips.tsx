import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius } from '../theme';
import { Field } from './Field';

type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  error?: string;
};

/** Single choice from a few options, shown as chips (no native picker needed). */
export function OptionChips<T extends string>({ label, options, value, onChange, error }: Props<T>) {
  return (
    <Field label={label} error={error}>
      <View style={styles.row} accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => onChange(option.value)}
              style={[styles.chip, selected && styles.selected]}
            >
              <Text style={[styles.text, selected && styles.selectedText]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Field>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  selected: { backgroundColor: colors.primary, borderColor: colors.primary },
  text: { fontSize: 14, color: colors.text },
  selectedText: { color: colors.primaryText },
});
