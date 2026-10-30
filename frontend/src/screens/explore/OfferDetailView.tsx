import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { Airport, Offer } from '../../api/types';
import { useAuthGate } from '../../auth/gate';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { colors, radius } from '../../theme';
import { formatDate, formatPrice, stopoversLabel, ticketClassLabel } from '../../utils/format';

/** query: the request whose response led here; passed on to the booking. */
export function OfferDetailView({ id, query }: { id: number; query?: number }) {
  const requireAuth = useAuthGate();
  const offer = useQuery({
    queryKey: ['offers', id],
    queryFn: async () => (await api.get<Offer>(`/offers/${id}`)).data,
  });

  if (offer.isPending) {
    return <LoadingState />;
  }
  if (offer.isError) {
    if (isAxiosError(offer.error) && offer.error.response?.status === 404) {
      return <EmptyState message="This deal is not available." />;
    }
    return <ErrorState error={offer.error} onRetry={() => offer.refetch()} />;
  }

  const data = offer.data;
  return (
    <Card>
      <View style={styles.route}>
        <AirportBlock airport={data.origin} />
        <Text style={styles.arrow}>→</Text>
        <AirportBlock airport={data.destination} />
      </View>
      <View style={styles.priceRow}>
        <Text style={styles.price}>{formatPrice(data.price)}</Text>
        <Text style={styles.muted}>per person</Text>
      </View>
      <Detail label="Departure" value={formatDate(data.departure_date)} />
      <Detail label="Airline" value={data.airline} />
      <Detail label="Class" value={ticketClassLabel(data.ticket_class)} />
      <Detail label="Stopovers" value={stopoversLabel(data.stopovers)} />
      <Detail label="Offer valid until" value={formatDate(data.valid_until)} />
      {data.is_bookable ? (
        <Button
          title="Book"
          variant="accent"
          onPress={() => requireAuth({ screen: 'BookingNew', params: query ? { offer: id, query } : { offer: id } })}
        />
      ) : (
        <Text style={styles.notice}>This offer can no longer be booked.</Text>
      )}
    </Card>
  );
}

function AirportBlock({ airport }: { airport: Airport }) {
  return (
    <View style={styles.airport}>
      <Text style={styles.code}>{airport.code}</Text>
      <Text style={styles.city}>
        {airport.city}, {airport.country}
      </Text>
      <Text style={styles.muted}>{airport.name}</Text>
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  route: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  airport: { flex: 1, minWidth: 0 },
  arrow: { fontSize: 24, color: colors.primary },
  code: { fontSize: 28, fontWeight: '700', color: colors.text },
  city: { color: colors.text },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  price: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.accentText,
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  detail: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  label: { color: colors.muted },
  value: { color: colors.text, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: 13 },
  notice: { color: colors.danger },
});
