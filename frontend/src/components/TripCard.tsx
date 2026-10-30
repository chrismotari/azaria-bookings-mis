import { ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { colors, radius, shadow, space } from '../theme';
import { PressState } from './pressState';
import { TONES, Tone } from './StatusChip';

type Props = {
  /** The status tone; colours the card's left edge. */
  tone: Tone;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  children: ReactNode;
};

/** A booking or request in a customer's list; pressing it opens its detail. */
export function TripCard({ tone, selected, onPress, accessibilityLabel, children }: Props) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      aria-current={selected}
      onPress={onPress}
      style={({ pressed, hovered }: PressState) => [
        styles.card,
        { borderLeftColor: TONES[tone].color },
        (pressed || hovered || selected) && styles.pressed,
        selected && styles.selected,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    padding: space.lg,
    gap: space.md,
    ...shadow,
  },
  pressed: { borderTopColor: colors.primary, borderRightColor: colors.primary, borderBottomColor: colors.primary },
  selected: { backgroundColor: colors.primaryTint },
});
