import { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { colors, space } from '../theme';
import { Card } from './Card';

/** Scrollable page with content centred at a readable max width; `card` wraps the content in one card. */
export function Screen({
  children,
  maxWidth = 1100,
  card,
}: {
  children: ReactNode;
  maxWidth?: number;
  card?: boolean;
}) {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <View style={[styles.content, { maxWidth }]}>{card ? <Card>{children}</Card> : children}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  container: { padding: space.lg, alignItems: 'center' },
  content: { width: '100%', gap: space.lg },
});
