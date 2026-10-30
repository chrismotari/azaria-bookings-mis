import { StyleSheet, Text, View } from 'react-native';

import { Query } from '../api/types';
import { colors, font, radius, space, weight } from '../theme';
import { describeQuery } from '../utils/queries';
import { Icon, IconName } from './Icon';
import { RouteLine } from './RouteLine';

/** The criteria of a request for options, compact with an icon each. */
export function QuerySummary({ query }: { query: Query }) {
  const details = describeQuery(query);
  return (
    <View style={styles.box}>
      <RouteLine origin={query.origin} destination={query.destination} />
      <View style={styles.grid}>
        <Criterion icon="calendar-outline" label="Dates" value={details.dates} />
        <Criterion icon="cash-outline" label="Price per person" value={details.prices} />
        <Criterion icon="ribbon-outline" label="Class" value={details.ticketClass} />
        <Criterion icon="git-commit-outline" label="Max stopovers" value={details.maxStopovers} />
      </View>
      {query.message ? (
        <View style={styles.message}>
          <Icon name="chatbubble-ellipses-outline" size={16} color={colors.muted} />
          <Text style={styles.messageText}>{query.message}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Criterion({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={styles.criterion}>
      <Icon name={icon} size={16} color={colors.primary} />
      <View style={styles.criterionText}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md, columnGap: space.lg },
  criterion: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, flexGrow: 1, flexBasis: 160, minWidth: 0 },
  criterionText: { flexShrink: 1, minWidth: 0 },
  label: { fontSize: font.caption, color: colors.muted },
  value: { fontSize: font.body, fontWeight: weight.semibold, color: colors.text },
  message: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  messageText: { flexShrink: 1, fontSize: font.body, color: colors.text },
});
