import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Offer } from '../api/types';
import { colors, radius, shadow, space } from '../theme';
import { formatDate, formatPrice, stopoversLabel, ticketClassLabel } from '../utils/format';

/** Summary of an offer that opens its detail when pressed. */
export function OfferCard({ offer, onPress }: { offer: Offer; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${offer.origin.city} to ${offer.destination.city}, ${formatDate(offer.departure_date)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.top}>
        <View style={styles.shrink}>
          <Text style={styles.route}>
            {offer.origin.code} → {offer.destination.code}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {offer.origin.city} → {offer.destination.city}
          </Text>
        </View>
        <View style={styles.priceBox}>
          <Text style={styles.price}>{formatPrice(offer.price)}</Text>
          <Text style={styles.muted}>per person</Text>
        </View>
      </View>
      <Text style={styles.text}>{formatDate(offer.departure_date)}</Text>
      <Text style={styles.text}>
        {offer.airline} · {ticketClassLabel(offer.ticket_class)} · {stopoversLabel(offer.stopovers)}
      </Text>
      <Text style={styles.muted}>Offer valid until {formatDate(offer.valid_until)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 4,
    borderTopColor: colors.primary,
    padding: space.lg,
    gap: 6,
    ...shadow,
  },
  pressed: { borderColor: colors.primary },
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  shrink: { flexShrink: 1 },
  route: { fontSize: 18, fontWeight: '700', color: colors.primary },
  priceBox: { alignItems: 'flex-end', gap: 2 },
  price: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.accentText,
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  text: { color: colors.text },
  muted: { color: colors.muted, fontSize: 13 },
});
