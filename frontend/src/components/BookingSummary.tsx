import { StyleSheet, Text, View } from 'react-native';

import { Booking } from '../api/types';
import { colors, font, space, weight } from '../theme';
import { passengersLabel } from '../utils/bookings';
import { formatDate, formatPrice, ticketClassLabel } from '../utils/format';
import { AirlineBadge } from './AirlineBadge';
import { PriceTag } from './PriceTag';
import { RouteLine } from './RouteLine';
import { StopList } from './StopList';

/** The flight, passengers and price of a booking. */
export function BookingSummary({ booking }: { booking: Booking }) {
  const { offer } = booking;
  return (
    <View style={styles.box}>
      <View style={styles.airline}>
        <AirlineBadge airline={offer.airline} />
        <View style={styles.shrink}>
          <Text style={styles.airlineName}>{offer.airline.name}</Text>
          <Text style={styles.muted}>{ticketClassLabel(offer.ticket_class)}</Text>
        </View>
      </View>
      <RouteLine origin={offer.origin} destination={offer.destination} stopCount={booking.stop_count} />
      {booking.stop_count > 0 ? <StopList stops={booking.stops} /> : null}
      <Row label="Departure" value={formatDate(offer.departure_date)} />
      <Row
        label="Passengers"
        value={`${passengersLabel(booking.passenger_count)} × ${formatPrice(booking.unit_price)}`}
      />
      {booking.notes ? <Row label="Notes" value={booking.notes} /> : null}
      <View style={styles.total}>
        <Text style={styles.totalLabel}>Total</Text>
        <PriceTag amount={booking.total_price} />
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.md },
  airline: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  shrink: { flexShrink: 1 },
  airlineName: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  label: { color: colors.muted, minWidth: 110 },
  value: { color: colors.text, fontWeight: weight.semibold, flexShrink: 1 },
  total: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalLabel: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
});
