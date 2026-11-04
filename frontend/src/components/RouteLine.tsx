import { StyleSheet, Text, View } from 'react-native';

import { Airport } from '../api/types';
import { colors, font, radius, space, weight } from '../theme';
import { stopsLabel } from '../utils/format';
import { Icon } from './Icon';

type Props = {
  /** Null for "anywhere" (a request for options without that airport). */
  origin: Airport | null;
  destination: Airport | null;
  /** Number of stops. Leave out for a route without a known flight (a request); the line then shows a plane. */
  stopCount?: number;
  /** Large also shows the airport names (offer detail header). */
  size?: 'regular' | 'large';
};

/** Origin and destination codes and cities joined by a line with one dot per stop. */
export function RouteLine({ origin, destination, stopCount, size = 'regular' }: Props) {
  const large = size === 'large';
  return (
    <View style={styles.row}>
      <End airport={origin} large={large} />
      <View style={styles.middle}>
        {stopCount === undefined ? null : (
          <Text style={[styles.stops, stopCount === 0 && styles.direct]}>{stopsLabel(stopCount)}</Text>
        )}
        {stopCount === undefined ? (
          <View style={styles.track}>
            <View style={styles.half} />
            <Icon name="airplane" size={14} color={colors.primary} />
            <View style={styles.half} />
          </View>
        ) : (
          <View style={styles.track}>
            <View style={styles.line} />
            {Array.from({ length: stopCount }, (_, index) => (
              <View key={index} style={styles.dot} />
            ))}
          </View>
        )}
      </View>
      <End airport={destination} large={large} alignEnd />
    </View>
  );
}

function End({ airport, large, alignEnd }: { airport: Airport | null; large: boolean; alignEnd?: boolean }) {
  const align = alignEnd && styles.alignEnd;
  if (!airport) {
    return (
      <View style={[styles.end, large && styles.endLarge, alignEnd && styles.endRight]}>
        <Text style={[styles.code, large && styles.codeLarge, styles.anywhere, align]}>Any</Text>
        <Text style={[styles.city, align]}>Anywhere</Text>
      </View>
    );
  }
  return (
    <View style={[styles.end, large && styles.endLarge, alignEnd && styles.endRight]}>
      <Text style={[styles.code, large && styles.codeLarge, align]}>{airport.code}</Text>
      <Text style={[styles.city, align]} numberOfLines={large ? 2 : 1}>
        {large ? `${airport.city}, ${airport.country}` : airport.city}
      </Text>
      {large ? (
        <Text style={[styles.name, align]} numberOfLines={2}>
          {airport.name}
        </Text>
      ) : null}
    </View>
  );
}

const DOT = 10;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  end: { flexShrink: 1, minWidth: 0, maxWidth: '35%' },
  endLarge: { flexBasis: '40%', maxWidth: '40%' },
  endRight: { alignItems: 'flex-end' },
  alignEnd: { textAlign: 'right' },
  code: { fontSize: font.heading, fontWeight: weight.heavy, color: colors.text },
  anywhere: { color: colors.muted },
  codeLarge: { fontSize: font.display },
  city: { fontSize: font.small, color: colors.text },
  name: { fontSize: font.caption, color: colors.muted },
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
  line: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: (DOT - 2) / 2,
    height: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.light,
  },
  half: { flex: 1, height: 2, marginHorizontal: space.xs, borderRadius: radius.pill, backgroundColor: colors.light },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
});
