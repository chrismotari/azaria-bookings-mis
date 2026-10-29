import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../auth/AuthContext';
import { useSignOut } from '../../auth/useSignOut';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { colors } from '../../theme';

export function AccountScreen() {
  const { user } = useAuth();
  const signOut = useSignOut();
  if (!user) {
    return null;
  }
  return (
    <Screen maxWidth={560}>
      <Card>
        <Row label="Name" value={user.full_name} />
        <Row label="Email" value={user.email} />
        <Row label="Phone" value={user.phone} />
      </Card>
      <Button title="Log out" variant="secondary" onPress={signOut} />
    </Screen>
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
  row: { gap: 2 },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted },
  value: { fontSize: 16, color: colors.text },
});
