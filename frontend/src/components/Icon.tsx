import Ionicons from '@expo/vector-icons/Ionicons';
import { ComponentProps } from 'react';

import { colors } from '../theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  /** Only for an icon that is the whole content of a control; otherwise it is hidden from screen readers. */
  label?: string;
};

export function Icon({ name, size = 18, color = colors.text, label }: Props) {
  return label ? (
    <Ionicons name={name} size={size} color={color} accessibilityLabel={label} role="img" />
  ) : (
    <Ionicons name={name} size={size} color={color} aria-hidden />
  );
}
