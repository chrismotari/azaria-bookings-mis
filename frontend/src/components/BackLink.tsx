import { StyleSheet, View } from 'react-native';

import { Button } from './Button';

/** "← <label>" above a page's title: the way back for pages opened from a list (they have no back arrow). */
export function BackLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <View style={styles.back}>
      <Button title={`← ${label}`} variant="link" onPress={onPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start' },
});
