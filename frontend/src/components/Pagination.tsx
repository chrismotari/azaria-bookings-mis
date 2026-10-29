import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme';
import { Button } from './Button';

const PAGE_SIZE = 20;

type Props = { page: number; count: number; onChange: (page: number) => void };

export function Pagination({ page, count, onChange }: Props) {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  if (pages === 1) {
    return null;
  }
  return (
    <View style={styles.row}>
      <Button title="Previous" variant="secondary" disabled={page <= 1} onPress={() => onChange(page - 1)} />
      <Text style={styles.text}>
        Page {page} of {pages}
      </Text>
      <Button title="Next" variant="secondary" disabled={page >= pages} onPress={() => onChange(page + 1)} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  text: { color: colors.muted },
});
