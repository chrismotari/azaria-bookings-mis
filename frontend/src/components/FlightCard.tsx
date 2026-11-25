import { Image, Text, View } from 'react-native';

import { Offer } from '../api/types';
import { colors, createStyles, font, space, weight } from '../theme';
import { routeCodes, ticketClassLabel, tripDates } from '../utils/format';
import { AirlineBadge } from './AirlineBadge';
import { CardFact, CardPrice, ItemCard } from './ItemCard';

const PLANE = require('../../assets/plane.jpg');

/** A flight offer as a card: the route over the plane photo, then dates, trip type and class, and the price. */
export function FlightCard({ offer, onPress }: { offer: Offer; onPress: () => void }) {
  const isReturn = offer.trip_type === 'return';
  return (
    <ItemCard
      accessibilityLabel={`${offer.origin.city} to ${offer.destination.city}${isReturn ? ' and back' : ''}, ${offer.airline.name}, ${tripDates(offer)}`}
      onPress={onPress}
      featured={offer.is_featured}
      image={
        <View style={styles.image}>
          <Image source={PLANE} style={styles.photo} resizeMode="cover" accessible={false} />
          <View style={styles.scrim}>
            <View style={styles.badge}>
              <AirlineBadge airline={offer.airline} size={36} />
            </View>
            <Text style={styles.route}>{routeCodes(offer.origin, offer.destination, isReturn)}</Text>
            <Text style={styles.cities} numberOfLines={1}>
              {offer.origin.city} {isReturn ? '⇄' : '→'} {offer.destination.city}
            </Text>
          </View>
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
  image: { flex: 1, backgroundColor: colors.dark },
  photo: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  scrim: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'flex-end',
    padding: space.lg,
    gap: 2,
  },
  badge: { position: 'absolute', top: space.sm, right: space.sm },
  route: { fontSize: font.display, fontWeight: weight.heavy, color: colors.onImage },
  cities: { fontSize: font.small, fontWeight: weight.semibold, color: colors.onImage },
}));
