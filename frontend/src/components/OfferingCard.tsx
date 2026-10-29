import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Offering } from '../api/types';
import { colors } from '../theme';
import { formatDate, formatPrice, stopoversLabel, ticketClassLabel } from '../utils/format';

/** Summary of an offering that opens its detail when pressed. */
export function OfferingCard({ offering, onPress }: { offering: Offering; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${offering.origin.city} to ${offering.destination.city}, ${formatDate(offering.departure_date)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.top}>
        <View style={styles.shrink}>
          <Text style={styles.route}>
            {offering.origin.code} → {offering.destination.code}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {offering.origin.city} → {offering.destination.city}
          </Text>
        </View>
        <View style={styles.priceBox}>
          <Text style={styles.price}>{formatPrice(offering.price)}</Text>
          <Text style={styles.muted}>per person</Text>
        </View>
      </View>
      <Text style={styles.text}>{formatDate(offering.departure_date)}</Text>
      <Text style={styles.text}>
        {offering.airline} · {ticketClassLabel(offering.ticket_class)} · {stopoversLabel(offering.stopovers)}
      </Text>
      <Text style={styles.muted}>Offer valid until {formatDate(offering.valid_until)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 6,
  },
  pressed: { borderColor: colors.primary },
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  shrink: { flexShrink: 1 },
  route: { fontSize: 18, fontWeight: '700', color: colors.text },
  priceBox: { alignItems: 'flex-end' },
  price: { fontSize: 18, fontWeight: '700', color: colors.primary },
  text: { color: colors.text },
  muted: { color: colors.muted, fontSize: 13 },
});
