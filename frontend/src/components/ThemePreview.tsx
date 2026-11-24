import { Text, View } from 'react-native';

import { colors, createStyles, font, radius, space, ThemeColors, weight } from '../theme';
import { formatPrice } from '../utils/format';

type Props = {
  /** The theme shown, which need not be the one in use. */
  theme: ThemeColors;
  /** The agency's name in the top bar; "Your agency" when not known yet. */
  name?: string;
};

/** How a theme looks: the top bar, text and a link on the tint, and the accent's Book button beside a price. */
export function ThemePreview({ theme, name }: Props) {
  return (
    <View style={styles.frame} accessibilityLabel="Theme preview">
      <View style={[styles.bar, { backgroundColor: theme.primary }]}>
        <Text style={[styles.brand, { color: theme.primary_text }]} numberOfLines={1}>
          {name?.trim() || 'Your agency'}
        </Text>
      </View>
      <View style={styles.body}>
        <View style={[styles.tint, { backgroundColor: theme.primary_tint }]}>
          <Text style={styles.text}>
            Your flight options are ready. <Text style={[styles.link, { color: theme.primary }]}>See your request</Text>
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.price}>{formatPrice(420)}</Text>
          <View style={[styles.book, { backgroundColor: theme.accent }]}>
            <Text style={[styles.bookText, { color: theme.accent_text }]}>Book</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = createStyles(() => ({
  frame: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  bar: { paddingVertical: space.md, paddingHorizontal: space.lg },
  brand: { fontSize: font.heading, fontWeight: weight.heavy },
  body: { padding: space.md, gap: space.md },
  tint: { borderRadius: radius.sm, padding: space.md },
  text: { fontSize: font.body, color: colors.text },
  link: { textDecorationLine: 'underline', fontWeight: weight.semibold },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  price: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  book: { borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: space.lg },
  bookText: { fontSize: font.body, fontWeight: weight.semibold },
}));
