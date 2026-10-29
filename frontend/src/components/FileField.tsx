import { createElement } from 'react';
import { Platform, StyleSheet, Text } from 'react-native';

import { colors } from '../theme';
import { Field } from './Field';

type Props = {
  label: string;
  /** e.g. ".pdf,.png,.jpg,.jpeg" */
  accept: string;
  onSelect: (files: File[]) => void;
  disabled?: boolean;
  error?: string;
};

/** The browser's file input on web; on native, a notice that uploads need the web app. */
export function FileField({ label, accept, onSelect, disabled, error }: Props) {
  return (
    <Field label={label} error={error}>
      {Platform.OS === 'web' ? (
        createElement('input', {
          type: 'file',
          accept,
          multiple: true,
          disabled,
          'aria-label': label,
          onChange: (event: { target: HTMLInputElement }) => {
            const files = Array.from(event.target.files ?? []);
            // Clear the input so choosing the same file again still triggers a change.
            event.target.value = '';
            if (files.length) {
              onSelect(files);
            }
          },
          style: { fontFamily: 'inherit', fontSize: 15, color: colors.text, maxWidth: '100%' },
        })
      ) : (
        <Text style={styles.notice}>Uploading files is available on the web app.</Text>
      )}
    </Field>
  );
}

const styles = StyleSheet.create({
  notice: { color: colors.muted },
});
