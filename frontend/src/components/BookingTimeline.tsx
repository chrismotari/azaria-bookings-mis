import { StyleSheet, Text, View } from 'react-native';

import { BookingEvent } from '../api/types';
import { colors } from '../theme';
import { BOOKING_EVENT_LABELS } from '../utils/bookings';
import { formatDateTime } from '../utils/format';

/** The booking's status changes, oldest first. */
export function BookingTimeline({ events }: { events: BookingEvent[] }) {
  return (
    <View style={styles.list}>
      {events.map((event) => (
        <View key={event.id} style={styles.item}>
          <View style={styles.dot} />
          <View style={styles.body}>
            <Text style={styles.label}>{BOOKING_EVENT_LABELS[event.to_status]}</Text>
            <Text style={styles.muted}>{formatDateTime(event.created_at)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  item: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginTop: 5 },
  body: { flexShrink: 1 },
  label: { color: colors.text, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: 13 },
});
