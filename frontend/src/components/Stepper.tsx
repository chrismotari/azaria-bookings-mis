import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, space, weight } from '../theme';
import { Field } from './Field';
import { Icon, IconName } from './Icon';
import { PressState } from './pressState';

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Screen-reader names of the − and + buttons, e.g. "Remove a passenger". */
  decreaseLabel: string;
  increaseLabel: string;
  error?: string;
};

/** A whole number changed with − and + buttons, kept within min and max. */
export function Stepper({ label, value, min, max, onChange, decreaseLabel, increaseLabel, error }: Props) {
  return (
    <Field label={label} error={error}>
      <View style={styles.row}>
        <StepButton icon="remove" label={decreaseLabel} disabled={value <= min} onPress={() => onChange(value - 1)} />
        <Text style={styles.value} aria-live="polite" accessibilityLabel={`${label}: ${value}`}>
          {value}
        </Text>
        <StepButton icon="add" label={increaseLabel} disabled={value >= max} onPress={() => onChange(value + 1)} />
      </View>
    </Field>
  );
}

type StepButtonProps = { icon: IconName; label: string; disabled: boolean; onPress: () => void };

function StepButton({ icon, label, disabled, onPress }: StepButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ hovered, focused }: PressState) => [
        styles.button,
        hovered && !disabled && styles.hovered,
        disabled && styles.disabled,
        focused && styles.focused,
      ]}
    >
      <Icon name={icon} size={20} color={colors.primary} />
    </Pressable>
  );
}

const SIZE = 40;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  hovered: { backgroundColor: colors.primaryTint },
  disabled: { opacity: 0.35 },
  focused: { outlineColor: colors.primary, outlineStyle: 'solid', outlineWidth: 2, outlineOffset: 2 },
  value: { minWidth: 32, textAlign: 'center', fontSize: font.title, fontWeight: weight.bold, color: colors.text },
});
