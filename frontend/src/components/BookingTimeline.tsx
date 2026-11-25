import { Text, View } from 'react-native';

import { BookingEvent, BookingStatus } from '../api/types';
import { colors, createStyles, font, weight } from '../theme';
import { BOOKING_EVENT_LABELS } from '../utils/bookings';
import { formatDateTime } from '../utils/format';

/** labels: what each status's event is called; the flight booking's unless given. */
export function BookingTimeline({
  events,
  labels = BOOKING_EVENT_LABELS,
}: {
  events: Pick<BookingEvent, 'id' | 'to_status' | 'created_at'>[];
  labels?: Record<BookingStatus, string>;
}) {
  return (
    <View style={styles.list}>
      {events.map((event) => (
        <View key={event.id} style={styles.item}>
          <View style={styles.dot} />
          <View style={styles.body}>
            <Text style={styles.label}>{labels[event.to_status]}</Text>
            <Text style={styles.muted}>{formatDateTime(event.created_at)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = createStyles(() => ({
  list: { gap: 10 },
  item: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginTop: 5 },
  body: { flexShrink: 1 },
  label: { color: colors.text, fontWeight: weight.semibold },
  muted: { color: colors.muted, fontSize: font.small },
}));
