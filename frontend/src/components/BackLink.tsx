import { StyleSheet, View } from 'react-native';

import { Button } from './Button';

/** For pages opened from a list, which have no back arrow. */
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
