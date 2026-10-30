import { ActivityIndicator, Pressable, PressableStateCallbackType, StyleSheet, Text } from 'react-native';

import { colors, radius, space } from '../theme';

type Variant = 'primary' | 'accent' | 'secondary' | 'danger' | 'link';

type Props = {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
};

/** react-native-web also reports keyboard focus to the style callback. */
type State = PressableStateCallbackType & { focused?: boolean };

const TEXT_COLOR: Record<Variant, string> = {
  primary: colors.primaryText,
  accent: colors.accentText,
  secondary: colors.tertiary,
  danger: colors.primaryText,
  link: colors.primary,
};

export function Button({ title, onPress, variant = 'primary', disabled, loading }: Props) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={inactive}
      style={({ pressed, focused }: State) => [
        styles.base,
        styles[variant],
        inactive && styles.disabled,
        pressed && styles.pressed,
        focused && styles.focused,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={TEXT_COLOR[variant]} />
      ) : (
        <Text style={[styles.text, { color: TEXT_COLOR[variant] }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.primary },
  accent: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.tertiary },
  danger: { backgroundColor: colors.danger },
  link: { paddingHorizontal: 0, paddingVertical: space.xs, alignItems: 'flex-start' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  focused: { outlineColor: colors.primary, outlineStyle: 'solid', outlineWidth: 2, outlineOffset: 2 },
  text: { fontSize: 15, fontWeight: '600' },
});
