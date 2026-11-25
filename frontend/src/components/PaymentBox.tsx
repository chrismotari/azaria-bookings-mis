import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { colors, createStyles, font, radius, space, weight } from '../theme';
import { timeLeft } from '../utils/bookings';
import { formatDateTime } from '../utils/format';
import { Icon } from './Icon';

type Props = { title: string; deadline: string | null; instructions: string | null; lapse: string };

/** Payment instructions and the deadline with a countdown, refreshed each minute. */
export function PaymentBox({ title, deadline, instructions, lapse }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const passed = deadline !== null && new Date(deadline).getTime() <= now;

  return (
    <View style={styles.payment}>
      <View style={styles.title}>
        <Icon name="card-outline" size={22} color={colors.primary} />
        <Text style={styles.section}>{title}</Text>
      </View>
      {deadline ? (
        <View style={styles.deadlineRow}>
          <Text style={styles.deadline}>Pay by {formatDateTime(deadline)}</Text>
          <View style={[styles.countdown, passed && styles.countdownPassed]}>
            <Icon name="time-outline" size={14} color={passed ? colors.dangerText : colors.warningText} />
            <Text style={[styles.countdownText, passed && styles.countdownTextPassed]}>{timeLeft(deadline, now)}</Text>
          </View>
        </View>
      ) : null}
      <Text style={styles.instructions}>{instructions}</Text>
      <Text style={styles.muted}>{lapse}</Text>
    </View>
  );
}

const styles = createStyles(() => ({
  payment: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  title: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  section: { fontSize: font.heading, fontWeight: weight.bold, color: colors.tertiary },
  deadlineRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  deadline: { color: colors.text, fontWeight: weight.bold },
  countdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.warningTint,
  },
  countdownPassed: { backgroundColor: colors.dangerTint },
  countdownText: { fontSize: font.small, fontWeight: weight.bold, color: colors.warningText },
  countdownTextPassed: { color: colors.dangerText },
  instructions: {
    fontSize: font.body,
    color: colors.text,
    padding: space.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  muted: { color: colors.muted },
}));
