import { StyleSheet, Text, View } from 'react-native';

import { Stop } from '../api/types';
import { colors, font, radius, space, weight } from '../theme';
import { formatDuration } from '../utils/format';
import { TONES } from './StatusChip';

const KIND = {
  layover: { label: 'Layover', tone: TONES.info },
  stopover: { label: 'Stopover', tone: TONES.warning },
} as const;

/** Each stop in flight order: airport code and city, how long it lasts, and a Layover or Stopover tag. */
export function StopList({ stops }: { stops: Stop[] }) {
  return (
    <View style={styles.list}>
      {stops.map((stop, index) => {
        const kind = KIND[stop.kind];
        return (
          <View key={`${index}-${stop.airport.code}`} style={[styles.row, index > 0 && styles.divider]}>
            <View style={styles.dot} />
            <View style={styles.place}>
              <Text style={styles.code}>
                {stop.airport.code} <Text style={styles.city}>{stop.airport.city}</Text>
              </Text>
              <Text style={styles.duration}>{formatDuration(stop.duration_minutes)}</Text>
            </View>
            <View style={[styles.tag, { backgroundColor: kind.tone.background }]}>
              <Text style={[styles.tagText, { color: kind.tone.color }]}>{kind.label}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const DOT = 10;

const styles = StyleSheet.create({
  list: { gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  place: { flex: 1, minWidth: 0 },
  code: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  city: { fontWeight: weight.regular, color: colors.text },
  duration: { fontSize: font.small, color: colors.muted },
  tag: { borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 10 },
  tagText: { fontSize: font.caption, fontWeight: weight.bold },
});
