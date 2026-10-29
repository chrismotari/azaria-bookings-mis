import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '../theme';

type Props = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'link';
  disabled?: boolean;
  loading?: boolean;
};

export function Button({ title, onPress, variant = 'primary', disabled, loading }: Props) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [styles.base, styles[variant], inactive && styles.disabled, pressed && styles.pressed]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.primaryText : colors.primary} />
      ) : (
        <Text style={[styles.text, variant === 'primary' ? styles.primaryText : styles.secondaryText]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: 6, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary },
  link: { paddingHorizontal: 0, paddingVertical: 4, alignItems: 'flex-start' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  text: { fontSize: 15, fontWeight: '600' },
  primaryText: { color: colors.primaryText },
  secondaryText: { color: colors.primary },
});
