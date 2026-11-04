import { StyleSheet, View } from 'react-native';

import { colors } from '../theme';
import { FLAGS } from './flags.native';

const FLAG_WIDTH = 16;
const FLAG_HEIGHT = 12;

/** Native: the country's flag (flag-icons) bundled into the app and drawn with react-native-svg. */
export function Flag({ code }: { code: string | null | undefined }) {
  const Svg = code ? FLAGS[code.toLowerCase()] : undefined;
  if (!Svg) {
    return null;
  }
  return (
    <View style={styles.flag} aria-hidden>
      <Svg width={FLAG_WIDTH} height={FLAG_HEIGHT} preserveAspectRatio="xMidYMid slice" />
    </View>
  );
}

const styles = StyleSheet.create({
  flag: {
    width: FLAG_WIDTH,
    height: FLAG_HEIGHT,
    borderRadius: 2,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
