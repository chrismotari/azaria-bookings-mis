import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Connection, Direction, Itinerary, ItineraryDirection, Segment, Trip } from '../api/types';
import { colors, font, radius, space, weight } from '../theme';
import {
  baggageDetails,
  changeLabel,
  dayOffset,
  flightNumber,
  formatDate,
  formatDuration,
  refundLabel,
  stopsLabel,
} from '../utils/format';
import { AirlineBadge } from './AirlineBadge';
import { Card } from './Card';
import { Flag } from './Flag';
import { TONES } from './StatusChip';

export const DIRECTION_LABELS: Record<Direction, string> = { outbound: 'Outbound', return: 'Return' };

/** The directions an itinerary has, in order, with their labels. */
export function directionsOf(itinerary: Itinerary): { key: Direction; label: string; direction: ItineraryDirection }[] {
  const found: { key: Direction; label: string; direction: ItineraryDirection }[] = [
    { key: 'outbound', label: DIRECTION_LABELS.outbound, direction: itinerary.outbound },
  ];
  if (itinerary.return) {
    found.push({ key: 'return', label: DIRECTION_LABELS.return, direction: itinerary.return });
  }
  return found.filter((item) => item.direction.segments.length > 0);
}

/** Stops in the direction with the most, as the max_stopovers filter counts them. */
export function mostStops(itinerary: Itinerary): number {
  return Math.max(itinerary.outbound.stop_count, itinerary.return?.stop_count ?? 0);
}

/** "Return · Direct", "One way · 1 stop": a trip's type and its stops, for compact lines. */
export function tripSummary(trip: Pick<Trip, 'trip_type' | 'itinerary'>): string {
  return `${trip.trip_type === 'return' ? 'Return' : 'One way'} · ${stopsLabel(mostStops(trip.itinerary))}`;
}

/** One line for a direction in a result row: departure and arrival times, airport codes and the stops. */
export function DirectionLine({ direction }: { direction: ItineraryDirection }) {
  const first = direction.segments[0];
  const last = direction.segments[direction.segments.length - 1];
  if (!first || !last) {
    return null;
  }
  const offset = dayOffset(first.departure_date, last.arrival_date);
  return (
    <View style={styles.line}>
      <View style={styles.end}>
        <Text style={styles.time}>{first.departure_time}</Text>
        <Text style={styles.code}>{first.origin.code}</Text>
      </View>
      <View style={styles.middle}>
        <Text style={[styles.stops, direction.stop_count === 0 && styles.direct]}>{stopsLabel(direction.stop_count)}</Text>
        <View style={styles.track}>
          <View style={styles.rule} />
          {direction.connections.map((connection, index) => (
            <View key={index} style={styles.dot} />
          ))}
        </View>
      </View>
      <View style={[styles.end, styles.endRight]}>
        <Text style={styles.time}>
          {last.arrival_time}
          {offset ? <Text style={styles.offset}> {offset}</Text> : null}
        </Text>
        <Text style={styles.code}>{last.destination.code}</Text>
      </View>
    </View>
  );
}

/** A direction's flights with the connections between them, without a card of its own. */
export function DirectionDetails({ label, direction }: { label: string; direction: ItineraryDirection }) {
  const first = direction.segments[0];
  return (
    <View style={styles.details}>
      <Text style={styles.heading}>
        {label}
        {first ? <Text style={styles.headingDate}> · {formatDate(first.departure_date)}</Text> : null}
      </Text>
      {direction.segments.map((segment, index) => (
        <Fragment key={index}>
          {index > 0 && direction.connections[index - 1] ? (
            <ConnectionRow connection={direction.connections[index - 1]} />
          ) : null}
          <SegmentBlock segment={segment} />
        </Fragment>
      ))}
    </View>
  );
}

/** An itinerary card per direction (offer and booking detail). */
export function ItineraryCards({ itinerary }: { itinerary: Itinerary }) {
  return (
    <>
      {directionsOf(itinerary).map(({ key, label, direction }) => (
        <Card key={key}>
          <DirectionDetails label={label} direction={direction} />
        </Card>
      ))}
    </>
  );
}

function SegmentBlock({ segment }: { segment: Segment }) {
  const offset = dayOffset(segment.departure_date, segment.arrival_date);
  return (
    <View style={styles.segment}>
      <View style={styles.carrier}>
        <AirlineBadge airline={segment.airline} size={32} />
        <View style={styles.shrink}>
          <Text style={styles.flight}>
            {flightNumber(segment)} <Text style={styles.airlineName}>{segment.airline.name}</Text>
          </Text>
          {segment.operating_airline ? (
            <Text style={styles.muted}>Operated by {segment.operating_airline.name}</Text>
          ) : null}
        </View>
      </View>
      <View style={styles.stopsList}>
        <Stop time={segment.departure_time} airport={segment.origin} />
        <Stop time={segment.arrival_time} offset={offset} airport={segment.destination} />
      </View>
    </View>
  );
}

function Stop({ time, offset, airport }: { time: string; offset?: string; airport: Segment['origin'] }) {
  return (
    <View style={styles.stop}>
      <Text style={styles.stopTime}>
        {time}
        {offset ? <Text style={styles.offset}> {offset}</Text> : null}
      </Text>
      <Text style={styles.stopPlace}>
        <Text style={styles.stopCode}>{airport.code}</Text> {airport.city} · {airport.name}
      </Text>
    </View>
  );
}

const KIND = {
  layover: { label: 'Layover', tone: TONES.info },
  stopover: { label: 'Stopover', tone: TONES.warning },
} as const;

function ConnectionRow({ connection }: { connection: Connection }) {
  const kind = KIND[connection.kind];
  return (
    <View style={styles.connection}>
      <Flag code={connection.airport.country_code} />
      <Text style={styles.connectionText}>
        {formatDuration(connection.wait_minutes)} in {connection.airport.city} ({connection.airport.code})
      </Text>
      <View style={[styles.tag, { backgroundColor: kind.tone.background }]}>
        <Text style={[styles.tagText, { color: kind.tone.color }]}>{kind.label}</Text>
      </View>
    </View>
  );
}

/** Baggage per passenger and the refund and change policies, in plain words. */
export function TripConditions({ trip }: { trip: Trip }) {
  const baggage = baggageDetails(trip);
  return (
    <View style={styles.conditions}>
      <Text style={styles.heading}>Baggage and fare conditions</Text>
      <Row label="Checked baggage" value={baggage.checked} />
      <Row label="Cabin bag" value={baggage.cabin} />
      <Row label="Refunds" value={refundLabel(trip.refund_policy)} />
      <Row label="Changes" value={changeLabel(trip.change_policy)} />
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

const DOT = 10;

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  end: { minWidth: 0 },
  endRight: { alignItems: 'flex-end' },
  time: { fontSize: font.heading, fontWeight: weight.heavy, color: colors.text },
  offset: { fontSize: font.caption, fontWeight: weight.bold, color: colors.warningText },
  code: { fontSize: font.small, color: colors.muted },
  middle: { flex: 1, minWidth: 48, alignItems: 'center', gap: space.xs },
  stops: { fontSize: font.caption, fontWeight: weight.semibold, color: colors.muted },
  direct: { color: colors.successText },
  track: {
    alignSelf: 'stretch',
    minHeight: DOT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  rule: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: (DOT - 2) / 2,
    height: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.light,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  details: { gap: space.md },
  heading: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  headingDate: { fontSize: font.body, fontWeight: weight.regular, color: colors.muted },
  segment: { gap: space.sm },
  carrier: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  shrink: { flexShrink: 1, minWidth: 0 },
  flight: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  airlineName: { fontWeight: weight.regular },
  muted: { fontSize: font.small, color: colors.muted },
  stopsList: { gap: space.xs },
  stop: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, paddingLeft: space.xs },
  stopTime: { width: 72, fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  stopPlace: { flex: 1, minWidth: 0, fontSize: font.small, color: colors.text },
  stopCode: { fontWeight: weight.bold },
  connection: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  connectionText: { flexShrink: 1, fontSize: font.small, color: colors.text },
  tag: { borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 10 },
  tagText: { fontSize: font.caption, fontWeight: weight.bold },
  conditions: { gap: space.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  label: { color: colors.muted, minWidth: 130 },
  value: { color: colors.text, fontWeight: weight.semibold, flexShrink: 1 },
});
