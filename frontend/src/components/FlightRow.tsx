import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Offer } from '../api/types';
import { colors, font, radius, shadow, space, weight } from '../theme';
import { formatDate, ticketClassLabel } from '../utils/format';
import { AirlineBadge } from './AirlineBadge';
import { PressState } from './pressState';
import { PriceTag } from './PriceTag';
import { RouteLine } from './RouteLine';

type Props = {
  offer: Offer;
  selected?: boolean;
  /** Stacks the row for a narrow column (phones, or beside an open detail). */
  compact?: boolean;
  onPress: () => void;
};

export function FlightRow({ offer, selected, compact, onPress }: Props) {
  const airline = (
    <View style={styles.airline}>
      <AirlineBadge airline={offer.airline} />
      <View style={styles.shrink}>
        <Text style={styles.airlineName} numberOfLines={1}>
          {offer.airline.name}
        </Text>
        <Text style={styles.muted}>{ticketClassLabel(offer.ticket_class)}</Text>
      </View>
    </View>
  );
  const route = (
    <RouteLine origin={offer.origin} destination={offer.destination} stopCount={offer.stop_count} />
  );
  const validUntil = <Text style={styles.caption}>Offer valid until {formatDate(offer.valid_until)}</Text>;
  const price = (
    <View style={[styles.priceBox, compact && styles.priceBoxCompact]}>
      <PriceTag amount={offer.price} />
      <Text style={styles.caption}>per person</Text>
    </View>
  );
  // The whole row is the link, so "View deal" only looks like a button.
  const viewDeal = (
    <View style={styles.viewDeal}>
      <Text style={styles.viewDealText}>View deal</Text>
    </View>
  );

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${offer.origin.city} to ${offer.destination.city}, ${formatDate(offer.departure_date)}`}
      aria-current={selected}
      onPress={onPress}
      style={({ pressed, hovered }: PressState) => [
        styles.row,
        compact && styles.rowCompact,
        (pressed || hovered || selected) && styles.pressed,
        selected && styles.selected,
      ]}
    >
      {compact ? (
        <>
          <View style={styles.between}>
            {airline}
            <Text style={styles.date}>{formatDate(offer.departure_date)}</Text>
          </View>
          {route}
          <View style={[styles.between, styles.bottom]}>
            <View style={styles.shrink}>
              {price}
              {validUntil}
            </View>
            {viewDeal}
          </View>
        </>
      ) : (
        <>
          <View style={styles.airlineColumn}>{airline}</View>
          <View style={styles.routeColumn}>{route}</View>
          <View style={styles.dateColumn}>
            <Text style={styles.date}>{formatDate(offer.departure_date)}</Text>
            {validUntil}
          </View>
          <View style={styles.priceColumn}>
            {price}
            {viewDeal}
          </View>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    ...shadow,
  },
  rowCompact: { flexDirection: 'column', alignItems: 'stretch', gap: space.md },
  pressed: { borderColor: colors.primary },
  selected: { backgroundColor: colors.primaryTint },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  bottom: { alignItems: 'flex-end' },
  shrink: { flexShrink: 1, minWidth: 0, gap: 2 },
  airline: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1, minWidth: 0 },
  airlineColumn: { width: 170 },
  routeColumn: { flex: 1, minWidth: 0 },
  dateColumn: { width: 160, gap: 2 },
  priceColumn: { alignItems: 'flex-end', gap: space.sm },
  airlineName: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  date: { fontSize: font.body, fontWeight: weight.semibold, color: colors.text },
  priceBox: { alignItems: 'flex-end', gap: 2 },
  priceBoxCompact: { alignItems: 'flex-start' },
  muted: { fontSize: font.small, color: colors.muted },
  caption: { fontSize: font.caption, color: colors.muted },
  viewDeal: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  viewDealText: { fontSize: font.small, fontWeight: weight.semibold, color: colors.primaryText },
});
