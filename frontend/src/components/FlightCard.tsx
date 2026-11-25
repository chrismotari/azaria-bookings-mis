import { Text, View } from 'react-native';

import { Offer } from '../api/types';
import { colors, createStyles, font, space, weight } from '../theme';
import { routeCodes, ticketClassLabel, tripDates } from '../utils/format';
import { AirlineBadge } from './AirlineBadge';
import { CardFact, CardPrice, ItemCard } from './ItemCard';

/** A flight offer as a card: the route on the primary tint, then dates, trip type and class, and the price. */
export function FlightCard({ offer, onPress }: { offer: Offer; onPress: () => void }) {
  const isReturn = offer.trip_type === 'return';
  return (
    <ItemCard
      accessibilityLabel={`${offer.origin.city} to ${offer.destination.city}${isReturn ? ' and back' : ''}, ${offer.airline.name}, ${tripDates(offer)}`}
      onPress={onPress}
      featured={offer.is_featured}
      image={
        <View style={styles.image}>
          <View style={styles.badge}>
            <AirlineBadge airline={offer.airline} size={36} />
          </View>
          <Text style={styles.route}>{routeCodes(offer.origin, offer.destination, isReturn)}</Text>
          <Text style={styles.cities} numberOfLines={1}>
            {offer.origin.city} {isReturn ? '⇄' : '→'} {offer.destination.city}
          </Text>
        </View>
      }
      title={tripDates(offer)}
      price={<CardPrice amount={offer.price} after="per person" />}
    >
      <CardFact icon="airplane-outline">
        {isReturn ? 'Return' : 'One way'} · {ticketClassLabel(offer.ticket_class)}
      </CardFact>
      <CardFact icon="business-outline">{offer.airline.name}</CardFact>
    </ItemCard>
  );
}

const styles = createStyles(() => ({
  image: {
    flex: 1,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
    gap: space.xs,
  },
  badge: { position: 'absolute', top: space.sm, right: space.sm },
  route: { fontSize: font.display, fontWeight: weight.heavy, color: colors.primary },
  cities: { fontSize: font.small, color: colors.text },
}));
