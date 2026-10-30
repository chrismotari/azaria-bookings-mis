import { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { colors, space } from '../theme';

/** Scrollable page with content centred at a readable max width. */
export function Screen({ children, maxWidth = 1100 }: { children: ReactNode; maxWidth?: number }) {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <View style={[styles.content, { maxWidth }]}>{children}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  container: { padding: space.lg, alignItems: 'center' },
  content: { width: '100%', gap: space.lg },
});
