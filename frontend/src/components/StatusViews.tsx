import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '../api/errors';
import { colors, font, space, weight } from '../theme';
import { Button } from './Button';
import { Icon, IconName } from './Icon';

export function LoadingState() {
  return (
    <View style={styles.box}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <View style={styles.box}>
      <Text style={styles.error}>{errorMessage(error)}</Text>
      <Button title="Try again" variant="secondary" onPress={onRetry} />
    </View>
  );
}

type EmptyProps = {
  icon: IconName;
  title: string;
  message: string;
  /** The screen's existing next step, if it has one. */
  action?: { title: string; onPress: () => void };
};

export function EmptyState({ icon, title, message, action }: EmptyProps) {
  return (
    <View style={styles.box}>
      <View style={styles.iconCircle}>
        <Icon name={icon} size={28} color={colors.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.muted}>{message}</Text>
      {action ? <Button title={action.title} variant="accent" onPress={action.onPress} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: space.xxl, alignItems: 'center', gap: space.md },
  error: { color: colors.danger, textAlign: 'center' },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text, textAlign: 'center' },
  muted: { color: colors.muted, textAlign: 'center', maxWidth: 420 },
});
