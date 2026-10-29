import { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { colors } from '../../theme';

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Screen maxWidth={440}>
      <Text style={styles.brand}>Azaria Bookings</Text>
      <Card>
        <Text style={styles.title}>{title}</Text>
        {children}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { fontSize: 22, fontWeight: '700', color: colors.primary, textAlign: 'center', marginTop: 24 },
  title: { fontSize: 20, fontWeight: '600', color: colors.text },
});
