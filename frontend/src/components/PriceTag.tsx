import { StyleSheet, Text } from 'react-native';

import { colors, font, radius, space, weight } from '../theme';
import { formatPrice } from '../utils/format';

/** An amount in the price style: dark text on amber. */
export function PriceTag({ amount, size = 'regular' }: { amount: string | number; size?: 'regular' | 'large' }) {
  return <Text style={[styles.price, size === 'large' && styles.large]}>{formatPrice(amount)}</Text>;
}

const styles = StyleSheet.create({
  price: {
    alignSelf: 'flex-start',
    fontSize: font.heading,
    fontWeight: weight.bold,
    color: colors.accentText,
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  large: { fontSize: font.display, paddingHorizontal: space.md },
});
