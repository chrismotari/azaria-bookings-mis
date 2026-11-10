import { createElement, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '../components/Icon';
import { PressState } from '../components/pressState';
import { colors, font, radius, space, weight } from '../theme';

export const ATTACH_ACCEPT = '.pdf,.png,.jpg,.jpeg';

/** One optional attachment (PDF, PNG or JPEG, up to 5 MB): a small button, then the chosen file with Remove. */
export function AttachButton({ file, onChange }: { file: File | null; onChange: (file: File | null) => void }) {
  const input = useRef<HTMLInputElement | null>(null);
  if (Platform.OS !== 'web') {
    return null;
  }
  return (
    <View style={styles.row}>
      {file ? (
        <View style={styles.chosen}>
          <Icon name="document-attach-outline" size={16} color={colors.primary} />
          <Text style={styles.name} numberOfLines={1}>
            {file.name}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${file.name}`}
            onPress={() => onChange(null)}
          >
            <Icon name="close" size={16} color={colors.muted} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach a file"
          onPress={() => input.current?.click()}
          style={({ hovered }: PressState) => [styles.attach, hovered && styles.hovered]}
        >
          <Icon name="attach-outline" size={18} color={colors.primary} />
          <Text style={styles.attachText}>Attach a file</Text>
          <Text style={styles.hint}>PDF, PNG or JPEG, up to 5 MB</Text>
        </Pressable>
      )}
      {createElement('input', {
        ref: input,
        type: 'file',
        accept: ATTACH_ACCEPT,
        tabIndex: -1,
        'aria-hidden': true,
        style: { display: 'none' },
        onChange: (event: { target: HTMLInputElement }) => {
          onChange(event.target.files?.[0] ?? null);
          event.target.value = '';
        },
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  attach: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.xs,
    borderRadius: radius.sm,
    flexWrap: 'wrap',
  },
  hovered: { opacity: 0.8 },
  attachText: { color: colors.primary, fontWeight: weight.semibold, fontSize: font.small },
  hint: { color: colors.muted, fontSize: font.caption },
  chosen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    maxWidth: '100%',
  },
  name: { color: colors.text, fontSize: font.small, flexShrink: 1 },
});
