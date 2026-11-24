import { View } from 'react-native';

import { Button } from './Button';
import { createStyles } from '../theme';

/** For pages opened from a list, which have no back arrow. */
export function BackLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <View style={styles.back}>
      <Button title={`← ${label}`} variant="link" onPress={onPress} />
    </View>
  );
}

const styles = createStyles(() => ({
  back: { alignSelf: 'flex-start' },
}));
