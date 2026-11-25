import { Pressable } from 'react-native';

import { colors, createStyles, radius } from '../theme';
import { Icon } from './Icon';
import { PressState } from './pressState';

type Props = {
  featured: boolean;
  onChange: (featured: boolean) => void;
  disabled?: boolean;
};

/** A filled star when featured on Explore; pressing it switches. */
export function FeatureStar({ featured, onChange, disabled }: Props) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={featured ? 'Remove from featured' : 'Feature on Explore'}
      accessibilityState={{ checked: featured, disabled }}
      aria-checked={featured}
      disabled={disabled}
      onPress={() => onChange(!featured)}
      style={({ hovered, pressed }: PressState) => [
        styles.star,
        (hovered || pressed) && !disabled && styles.hovered,
        disabled && styles.disabled,
      ]}
    >
      <Icon name={featured ? 'star' : 'star-outline'} size={20} color={featured ? colors.accent : colors.muted} />
    </Pressable>
  );
}

const styles = createStyles(() => ({
  star: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  hovered: { backgroundColor: colors.background },
  disabled: { opacity: 0.4 },
}));
