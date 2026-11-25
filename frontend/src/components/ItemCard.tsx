import { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { colors, createStyles, font, radius, shadow, space, weight } from '../theme';
import { Icon, IconName } from './Icon';
import { PressState } from './pressState';
import { PriceTag } from './PriceTag';

export const CARD_IMAGE_HEIGHT = 170;

type Props = {
  accessibilityLabel: string;
  onPress: () => void;
  /** Fills the image area, CARD_IMAGE_HEIGHT tall. */
  image: ReactNode;
  title: string;
  featured: boolean;
  /** Detail lines under the title. */
  children: ReactNode;
  price: ReactNode;
};

/** The one frame for flight, tour and hotel cards, so mixed rows line up: image, title, details, price last. */
export function ItemCard({ accessibilityLabel, onPress, image, title, featured, children, price }: Props) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${accessibilityLabel}${featured ? ', featured' : ''}`}
      onPress={onPress}
      style={({ hovered }: PressState) => [styles.card, hovered && styles.hovered]}
    >
      <View style={styles.image}>
        {image}
        {featured ? (
          <View style={styles.featured}>
            <Icon name="star" size={12} color={colors.accentText} />
            <Text style={styles.featuredText}>Featured</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {children}
        <View style={styles.price}>{price}</View>
      </View>
    </Pressable>
  );
}

/** A detail line with its icon. */
export function CardFact({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <View style={styles.fact}>
      <Icon name={icon} size={16} color={colors.muted} />
      <Text style={styles.muted} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

/** "From $X per person": the amount in the price colour. */
export function CardPrice({ amount, before, after }: { amount: string; before?: string; after?: string }) {
  return (
    <View style={styles.priceRow}>
      {before ? <Text style={styles.priceWords}>{before}</Text> : null}
      <PriceTag amount={amount} />
      {after ? <Text style={styles.priceWords}>{after}</Text> : null}
    </View>
  );
}

const styles = createStyles(() => ({
  card: {
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow,
  },
  hovered: { borderColor: colors.primary },
  image: { height: CARD_IMAGE_HEIGHT, overflow: 'hidden' },
  featured: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  featuredText: { fontSize: font.caption, fontWeight: weight.bold, color: colors.accentText },
  body: { flexGrow: 1, padding: space.lg, gap: space.sm },
  title: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  muted: { fontSize: font.small, color: colors.muted, flexShrink: 1 },
  price: { marginTop: 'auto', paddingTop: space.xs },
  priceRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  priceWords: { fontSize: font.small, color: colors.text },
}));
