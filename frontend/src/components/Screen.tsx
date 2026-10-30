import { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { colors, space } from '../theme';

type Props = {
  children: ReactNode;
  maxWidth?: number;
  /** Full-width band in the brand colour above the content, its inside centred at the same max width. */
  header?: ReactNode;
};

/** Scrollable page with content centred at a readable max width. */
export function Screen({ children, maxWidth = 1100, header }: Props) {
  return (
    <ScrollView style={styles.scroll}>
      {header ? (
        <View style={[styles.band, styles.header]}>
          <View style={[styles.content, { maxWidth }]}>{header}</View>
        </View>
      ) : null}
      <View style={styles.band}>
        <View style={[styles.content, { maxWidth }]}>{children}</View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  band: { padding: space.lg, alignItems: 'center' },
  header: { backgroundColor: colors.primary, paddingVertical: space.xl },
  content: { width: '100%', gap: space.lg },
});
