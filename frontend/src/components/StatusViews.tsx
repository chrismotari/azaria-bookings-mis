import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '../api/errors';
import { colors } from '../theme';
import { Button } from './Button';

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

export function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.box}>
      <Text style={styles.muted}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: 32, alignItems: 'center', gap: 12 },
  error: { color: colors.danger, textAlign: 'center' },
  muted: { color: colors.muted, textAlign: 'center' },
});
