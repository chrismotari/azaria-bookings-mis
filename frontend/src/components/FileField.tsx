import { createElement, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, space, weight } from '../theme';
import { FormError } from './Field';
import { Icon } from './Icon';
import { PressState } from './pressState';

type Props = {
  label: string;
  /** Shown under the label, e.g. the allowed types and sizes. */
  hint?: string;
  /** e.g. ".pdf,.png,.jpg,.jpeg" */
  accept: string;
  onSelect: (files: File[]) => void;
  disabled?: boolean;
  error?: string;
};

/**
 * A dashed upload area that opens the browser's file picker when clicked (web);
 * on native, a notice that uploads need the web app.
 */
export function FileField({ label, hint, accept, onSelect, disabled, error }: Props) {
  const input = useRef<HTMLInputElement | null>(null);

  if (Platform.OS !== 'web') {
    return <Text style={styles.notice}>Uploading files is available on the web app.</Text>;
  }
  return (
    <View style={styles.field}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onPress={() => input.current?.click()}
        style={({ hovered, focused }: PressState) => [
          styles.area,
          hovered && !disabled && styles.hovered,
          disabled && styles.disabled,
          focused && styles.focused,
        ]}
      >
        <View style={styles.iconCircle}>
          <Icon name="cloud-upload-outline" size={24} color={colors.primary} />
        </View>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </Pressable>
      {createElement('input', {
        ref: input,
        type: 'file',
        accept,
        multiple: true,
        disabled,
        'aria-label': label,
        tabIndex: -1,
        onChange: (event: { target: HTMLInputElement }) => {
          const files = Array.from(event.target.files ?? []);
          // Clear the input so choosing the same file again still triggers a change.
          event.target.value = '';
          if (files.length) {
            onSelect(files);
          }
        },
        style: { display: 'none' },
      })}
      <FormError message={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.xs },
  area: {
    alignItems: 'center',
    gap: space.xs,
    padding: space.xl,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.light,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  hovered: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  disabled: { opacity: 0.5 },
  focused: { outlineColor: colors.primary, outlineStyle: 'solid', outlineWidth: 2, outlineOffset: 2 },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: font.body, fontWeight: weight.bold, color: colors.primary },
  hint: { fontSize: font.small, color: colors.muted, textAlign: 'center' },
  notice: { color: colors.muted },
});
