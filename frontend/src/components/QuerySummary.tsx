import { StyleSheet, Text, View } from 'react-native';

import { Query } from '../api/types';
import { colors } from '../theme';
import { describeQuery } from '../utils/queries';

/** The criteria of a request for options. */
export function QuerySummary({ query }: { query: Query }) {
  const details = describeQuery(query);
  return (
    <View style={styles.box}>
      <Text style={styles.route}>{details.route}</Text>
      <Row label="Dates" value={details.dates} />
      <Row label="Price per person" value={details.prices} />
      <Row label="Class" value={details.ticketClass} />
      <Row label="Max stopovers" value={details.maxStopovers} />
      {query.message ? <Row label="Message" value={query.message} /> : null}
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
  label: { color: colors.muted, minWidth: 130 },
  value: { color: colors.text, flexShrink: 1 },
});
