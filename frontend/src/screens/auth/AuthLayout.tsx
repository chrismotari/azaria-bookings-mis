import { ReactNode } from 'react';
import { useNavigation } from '@react-navigation/native';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { colors } from '../../theme';

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const navigation = useNavigation();
  return (
    <Screen maxWidth={440}>
      <Pressable accessibilityRole="link" onPress={() => navigation.navigate('Main', { screen: 'Explore' })}>
        <Text style={styles.brand}>Azaria Bookings</Text>
      </Pressable>
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
