import { StyleSheet, Text, View } from 'react-native';

import { BookingChanges } from '../api/types';
import { colors, font, space, weight } from '../theme';
import { describeChanges } from '../utils/bookings';
import { Icon } from './Icon';

/** Each change made on confirming availability, as the old value (struck through) and the new one. */
export function ChangeList({ changes }: { changes: BookingChanges }) {
  return (
    <View style={styles.list}>
      {describeChanges(changes).map((change) => (
        <View key={change.label} style={styles.row}>
          <Text style={styles.label}>{change.label}</Text>
          <View style={styles.values}>
            <Text style={styles.old}>{change.old}</Text>
            <Icon name="arrow-forward" size={14} color={colors.muted} label="changed to" />
            <Text style={styles.new}>{change.new}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  label: { color: colors.muted, minWidth: 130 },
  values: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs, flexShrink: 1 },
  old: { color: colors.muted, textDecorationLine: 'line-through' },
  new: { color: colors.text, fontWeight: weight.bold, fontSize: font.body },
});
