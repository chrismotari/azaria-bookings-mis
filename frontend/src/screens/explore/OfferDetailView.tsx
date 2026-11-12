import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';

import { api } from '../../api/client';
import { Offer } from '../../api/types';
import { useAuthGate } from '../../auth/gate';
import { AirlineBadge } from '../../components/AirlineBadge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Icon, IconName } from '../../components/Icon';
import { ItineraryCards, TripConditions } from '../../components/Itinerary';
import { PriceTag } from '../../components/PriceTag';
import { RouteLine } from '../../components/RouteLine';
import { DetailError } from '../../components/DetailLayout';
import { LoadingState } from '../../components/StatusViews';
import { colors, font, space, weight } from '../../theme';
import { formatDate, ticketClassLabel, timeAgo } from '../../utils/format';

/** Width from which the price summary sits beside the details instead of below them. */
const TWO_COLUMNS = 640;

/** query: the request whose response led here; passed on to the booking. */
export function OfferDetailView({ id, query }: { id: string; query?: string }) {
  const requireAuth = useAuthGate();
  const [width, setWidth] = useState(0);
  const offer = useQuery({
    queryKey: ['offers', id],
    queryFn: async () => (await api.get<Offer>(`/offers/${id}`)).data,
  });

  if (offer.isPending) {
    return <LoadingState />;
  }
  if (offer.isError) {
    return (
      <DetailError
        error={offer.error}
        onRetry={() => offer.refetch()}
        notFound="Deal not found"
        message="This deal is not available."
      />
    );
  }

  const data = offer.data;
  const twoColumns = width >= TWO_COLUMNS;
  return (
    <View
      style={[styles.layout, twoColumns && styles.layoutRow]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <View style={styles.main}>
        <Card>
          <View style={styles.airline}>
            <AirlineBadge airline={data.airline} />
            <View>
              <Text style={styles.airlineName}>{data.airline.name}</Text>
              <Text style={styles.muted}>{ticketClassLabel(data.ticket_class)}</Text>
            </View>
          </View>
          <RouteLine
            origin={data.origin}
            destination={data.destination}
            stopCount={data.itinerary.outbound.stop_count}
            returnTrip={data.trip_type === 'return'}
            size="large"
          />
        </Card>
        <Card>
          <Text style={styles.heading}>Flight details</Text>
          <View style={styles.grid}>
            <Detail icon="calendar-outline" label="Departure date" value={formatDate(data.departure_date)} />
            {data.return_date ? (
              <Detail icon="return-down-back-outline" label="Return date" value={formatDate(data.return_date)} />
            ) : null}
            <Detail icon="airplane-outline" label="Ticketing airline" value={data.airline.name} />
            <Detail icon="ribbon-outline" label="Class" value={ticketClassLabel(data.ticket_class)} />
            <Detail icon="time-outline" label="Offer valid until" value={formatDate(data.valid_until)} />
          </View>
        </Card>
        <ItineraryCards itinerary={data.itinerary} />
        <Card>
          <TripConditions trip={data} />
        </Card>
      </View>
      <View style={twoColumns && styles.summaryColumn}>
        <Card>
          <Text style={styles.muted}>
            {data.trip_type === 'return' ? 'Return price per person' : 'Price per person'}
          </Text>
          <PriceTag amount={data.price} size="large" />
          {data.price_checked_at ? (
            <Text style={styles.muted}>Price checked {timeAgo(data.price_checked_at)}</Text>
          ) : null}
          {data.is_bookable ? (
            <Button
              title="Book"
              variant="accent"
              onPress={() =>
                requireAuth({
                  screen: 'Main',
                  params: { screen: 'BookingNew', params: query ? { offer: id, query } : { offer: id } },
                })
              }
            />
          ) : (
            <Text style={styles.notice}>This offer can no longer be booked.</Text>
          )}
        </Card>
      </View>
    </View>
  );
}

function Detail({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <View style={styles.detailIcon}>
        <Icon name={icon} size={18} color={colors.primary} />
      </View>
      <View style={styles.detailText}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layout: { gap: space.lg },
  layoutRow: { flexDirection: 'row', alignItems: 'flex-start' },
  main: { flex: 1, minWidth: 0, gap: space.lg },
  // Sticky (web) keeps the price and Book button in view while the details scroll.
  summaryColumn: { width: 260, position: 'sticky', top: 0 } as unknown as ViewStyle,
  airline: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  airlineName: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  heading: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.lg, columnGap: space.md },
  detail: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexGrow: 1, flexBasis: 200, minWidth: 0 },
  detailIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailText: { flexShrink: 1, minWidth: 0 },
  label: { fontSize: font.caption, color: colors.muted },
  value: { fontSize: font.body, fontWeight: weight.semibold, color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
  notice: { color: colors.danger },
});
