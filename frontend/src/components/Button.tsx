import { ActivityIndicator, Pressable, Text } from 'react-native';

import { colors, createStyles, font, radius, space, weight } from '../theme';
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

/** Read while rendering: the brand colours follow the agency's theme. */
function textColor(variant: Variant): string {
  return {
    primary: colors.primaryText,
    accent: colors.accentText,
    secondary: colors.tertiary,
    danger: colors.primaryText,
    link: colors.primary,
  }[variant];
}

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
        <ActivityIndicator color={textColor(variant)} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={17} color={textColor(variant)} /> : null}
          <Text style={[styles.text, { color: textColor(variant) }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = createStyles(() => ({
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
}));
