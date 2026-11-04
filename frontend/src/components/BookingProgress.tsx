import { StyleSheet, Text, View } from 'react-native';

import { BookingStatus } from '../api/types';
import { colors, font, radius, space, weight } from '../theme';
import { BOOKING_STATUS } from '../utils/bookings';
import { Icon, IconName } from './Icon';
import { TONES } from './StatusChip';

const STEPS: { status: BookingStatus; label: string }[] = [
  { status: 'requested', label: 'Requested' },
  { status: 'availability_confirmed', label: 'Confirmed' },
  { status: 'paid', label: 'Paid' },
  { status: 'completed', label: 'Completed' },
];

const TERMINAL: Partial<Record<BookingStatus, IconName>> = {
  unavailable: 'close-circle',
  cancelled: 'ban',
  expired: 'time',
  declined: 'arrow-undo',
};

/**
 * Where the booking is on the normal path (Requested → Confirmed → Paid → Completed),
 * or a single banner for a status that ends it (unavailable, cancelled, expired, declined).
 */
export function BookingProgress({ status, message }: { status: BookingStatus; message?: string }) {
  const terminalIcon = TERMINAL[status];
  if (terminalIcon) {
    const { label, tone } = BOOKING_STATUS[status];
    const { background, color } = TONES[tone];
    return (
      <View style={[styles.banner, { backgroundColor: background, borderLeftColor: color }]}>
        <Icon name={terminalIcon} size={22} color={color} />
        <View style={styles.bannerText}>
          <Text style={[styles.bannerTitle, { color }]}>{label}</Text>
          {message ? <Text style={styles.bannerMessage}>{message}</Text> : null}
        </View>
      </View>
    );
  }

  const current = STEPS.findIndex((step) => step.status === status);
  // The last step is done, not in progress, once the booking is completed.
  const doneUpTo = status === 'completed' ? current + 1 : current;
  return (
    <View style={styles.tracker} accessibilityLabel={`Progress: ${BOOKING_STATUS[status].label}`}>
      {STEPS.map((step, index) => {
        const done = index < doneUpTo;
        const isCurrent = index === current && !done;
        return (
          <View key={step.status} style={styles.step}>
            <View style={styles.markerRow}>
              <View style={[styles.connector, index === 0 && styles.hidden, index <= doneUpTo && styles.connectorDone]} />
              <View style={[styles.marker, done && styles.markerDone, isCurrent && styles.markerCurrent]}>
                {done ? (
                  <Icon name="checkmark" size={16} color={colors.primaryText} />
                ) : (
                  <Text style={[styles.number, isCurrent && styles.numberCurrent]}>{index + 1}</Text>
                )}
              </View>
              <View
                style={[
                  styles.connector,
                  index === STEPS.length - 1 && styles.hidden,
                  index < doneUpTo && styles.connectorDone,
                ]}
              />
            </View>
            <Text
              style={[styles.label, (done || isCurrent) && styles.labelActive]}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {step.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const MARKER = 28;

const styles = StyleSheet.create({
  tracker: { flexDirection: 'row' },
  step: { flex: 1, alignItems: 'center', gap: space.xs, minWidth: 0 },
  markerRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  connector: { flex: 1, height: 2, backgroundColor: colors.border },
  connectorDone: { backgroundColor: colors.primary },
  hidden: { opacity: 0 },
  marker: {
    width: MARKER,
    height: MARKER,
    borderRadius: MARKER / 2,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  markerCurrent: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  number: { fontSize: font.small, fontWeight: weight.bold, color: colors.muted },
  numberCurrent: { color: colors.primary },
  label: { fontSize: font.caption, color: colors.muted, textAlign: 'center' },
  labelActive: { color: colors.text, fontWeight: weight.semibold },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    borderLeftWidth: 4,
  },
  bannerText: { flexShrink: 1, gap: space.xs },
  bannerTitle: { fontSize: font.heading, fontWeight: weight.bold },
  bannerMessage: { fontSize: font.body, color: colors.text },
});
