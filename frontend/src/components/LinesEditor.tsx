import { Text, View } from 'react-native';

import { colors, createStyles, font, space, weight } from '../theme';
import { Button } from './Button';
import { FormError } from './Field';
import { TextField } from './TextField';

type Props = {
  label: string;
  lines: string[];
  onChange: (lines: string[]) => void;
  /** Most lines, and most characters per line. */
  maxLines: number;
  maxLength: number;
  error?: string;
};

/** A list of short lines of text, each its own field. */
export function LinesEditor({ label, lines, onChange, maxLines, maxLength, error }: Props) {
  return (
    <View style={styles.list}>
      <Text style={styles.strong}>{label}</Text>
      {lines.map((line, index) => (
        <View key={index} style={styles.lineRow}>
          <View style={styles.grow}>
            <TextField
              label={`${label} ${index + 1}`}
              value={line}
              onChangeText={(text) => onChange(lines.map((other, at) => (at === index ? text : other)))}
              maxLength={maxLength}
            />
          </View>
          <Button title="Remove" variant="link" onPress={() => onChange(lines.filter((_, other) => other !== index))} />
        </View>
      ))}
      <FormError message={error} />
      {lines.length < maxLines ? (
        <View style={styles.start}>
          <Button
            title={`Add to ${label.toLowerCase()}`}
            icon="add"
            variant="secondary"
            onPress={() => onChange([...lines, ''])}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = createStyles(() => ({
  list: { gap: space.md },
  strong: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  lineRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  grow: { flex: 1, minWidth: 0 },
  start: { alignSelf: 'flex-start' },
}));
