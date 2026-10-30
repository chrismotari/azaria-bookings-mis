import { StyleSheet, Text, View } from 'react-native';

import { Booking } from '../api/types';
import { colors } from '../theme';
import { bookingRoute, passengersLabel } from '../utils/bookings';
import { formatDate, formatPrice, stopoversLabel, ticketClassLabel } from '../utils/format';

/** The flight, passengers and price of a booking. */
export function BookingSummary({ booking }: { booking: Booking }) {
  const { offer } = booking;
  return (
    <View style={styles.box}>
      <Text style={styles.route}>{bookingRoute(booking)}</Text>
      <Row label="Departure" value={formatDate(offer.departure_date)} />
      <Row label="Airline" value={offer.airline} />
      <Row label="Class" value={ticketClassLabel(offer.ticket_class)} />
      <Row label="Stopovers" value={stopoversLabel(offer.stopovers)} />
      <Row
        label="Passengers"
        value={`${passengersLabel(booking.passenger_count)} × ${formatPrice(booking.unit_price)}`}
      />
      {booking.notes ? <Row label="Notes" value={booking.notes} /> : null}
      <Text style={styles.total}>Total {formatPrice(booking.total_price)}</Text>
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
  box: { gap: 6 },
  route: { fontSize: 18, fontWeight: '700', color: colors.text },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  label: { color: colors.muted, minWidth: 110 },
  value: { color: colors.text, flexShrink: 1 },
  total: { fontSize: 18, fontWeight: '700', color: colors.primary },
});
