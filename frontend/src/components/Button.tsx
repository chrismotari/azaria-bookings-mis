import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors, font, radius, space, weight } from '../theme';
import { Icon, IconName } from './Icon';
import { PressState } from './pressState';

type Variant = 'primary' | 'accent' | 'secondary' | 'danger' | 'link';

type Props = {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  /** Shown before the title. */
  icon?: IconName;
};

const TEXT_COLOR: Record<Variant, string> = {
  primary: colors.primaryText,
  accent: colors.accentText,
  secondary: colors.tertiary,
  danger: colors.primaryText,
  link: colors.primary,
};

export function Button({ title, onPress, variant = 'primary', disabled, loading, icon }: Props) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={inactive}
      style={({ pressed, hovered, focused }: PressState) => [
        styles.base,
        styles[variant],
        inactive && styles.disabled,
        !inactive && hovered && (variant === 'secondary' ? styles.secondaryHovered : styles.hovered),
        pressed && styles.pressed,
        focused && styles.focused,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={TEXT_COLOR[variant]} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={17} color={TEXT_COLOR[variant]} /> : null}
          <Text style={[styles.text, { color: TEXT_COLOR[variant] }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.primary },
  accent: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.tertiary },
  danger: { backgroundColor: colors.danger },
  link: { paddingHorizontal: 0, paddingVertical: space.xs, justifyContent: 'flex-start' },
  disabled: { opacity: 0.5 },
  hovered: { opacity: 0.9 },
  secondaryHovered: { backgroundColor: colors.neutralTint },
  pressed: { opacity: 0.8 },
  focused: { outlineColor: colors.primary, outlineStyle: 'solid', outlineWidth: 2, outlineOffset: 2 },
  text: { fontSize: font.body, fontWeight: weight.semibold },
});
