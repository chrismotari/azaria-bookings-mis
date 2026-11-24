import { Text } from 'react-native';

import { colors, createStyles, font } from '../../theme';
import { textOf } from './css';

/** Native: a description's text without its formatting. */
export function RichText({ html }: { html: string }) {
  const text = textOf(html);
  return text ? <Text style={styles.text}>{text}</Text> : null;
}

const styles = createStyles(() => ({
  text: { color: colors.text, fontSize: font.body, lineHeight: 22 },
}));
