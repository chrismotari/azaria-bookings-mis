import { Image, StyleSheet } from 'react-native';

import { colors } from '../theme';
import { FLAG_CODES } from './flagCodes';

type Props = {
  /** ISO 3166-1 alpha-2 country code, e.g. "KE"; nothing is shown when empty or unknown. */
  code: string | null | undefined;
};

/** Web: an image from public/flags/, so only the flags on screen are downloaded. Native: Flag.native.tsx. */
export function Flag({ code }: Props) {
  const key = code?.toLowerCase();
  if (!key || !FLAG_CODES.has(key)) {
    return null;
  }
  return (
    <Image source={{ uri: `/flags/${key}.svg` }} style={styles.flag} aria-hidden accessibilityIgnoresInvertColors />
  );
}

const FLAG_WIDTH = 16;
const FLAG_HEIGHT = 12;

const styles = StyleSheet.create({
  // A hairline border keeps white flags (e.g. Japan) visible.
  flag: {
    width: FLAG_WIDTH,
    height: FLAG_HEIGHT,
    borderRadius: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
