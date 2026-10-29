import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { Airport, Offering } from '../../api/types';
import { useAuthGate } from '../../auth/gate';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { RootStackParamList } from '../../navigation/types';
import { colors } from '../../theme';
import { formatDate, formatPrice, stopoversLabel, ticketClassLabel } from '../../utils/format';

export function OfferingDetailScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'OfferingDetail'>) {
  const { id, query } = route.params;
  const requireAuth = useAuthGate();
  const offering = useQuery({
    queryKey: ['offerings', id],
    queryFn: async () => (await api.get<Offering>(`/offerings/${id}`)).data,
  });
  const backToExplore = () => navigation.navigate('Main', { screen: 'Explore' });

  if (offering.isPending) {
    return <LoadingState />;
  }
  if (offering.isError) {
    if (isAxiosError(offering.error) && offering.error.response?.status === 404) {
      return (
        <Screen maxWidth={720}>
          <EmptyState message="This offering is not available." />
          <Button title="Browse other deals" onPress={backToExplore} />
        </Screen>
      );
    }
    return <ErrorState error={offering.error} onRetry={() => offering.refetch()} />;
  }

  const data = offering.data;
  return (
    <Screen maxWidth={720}>
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
            onPress={() =>
              requireAuth({ screen: 'BookingNew', params: query ? { offering: id, query } : { offering: id } })
            }
          />
        ) : (
          <Text style={styles.notice}>This offer can no longer be booked.</Text>
        )}
      </Card>
      <Button title="Back to deals" variant="secondary" onPress={backToExplore} />
    </Screen>
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
  arrow: { fontSize: 24, color: colors.muted },
  code: { fontSize: 28, fontWeight: '700', color: colors.text },
  city: { color: colors.text },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  price: { fontSize: 26, fontWeight: '700', color: colors.primary },
  detail: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  label: { color: colors.muted },
  value: { color: colors.text, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: 13 },
  notice: { color: colors.danger },
});
