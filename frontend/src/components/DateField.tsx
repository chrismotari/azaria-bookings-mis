import { createElement } from 'react';
import { Platform, TextInput } from 'react-native';

import { WEB_SYSTEM_FONT } from '../theme';
import { Field, inputStyle } from './Field';

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  /** Read by screen readers instead of the label, e.g. to tell repeated fields apart. */
  accessibilityLabel?: string;
};

/** "YYYY-MM-DD" value. The browser's date input on web, a plain text input on native. */
export function DateField({ label, value, onChange, error, accessibilityLabel = label }: Props) {
  return (
    <Field label={label} error={error}>
      {Platform.OS === 'web' ? (
        createElement('input', {
          type: 'date',
          value,
          'aria-label': accessibilityLabel,
          onChange: (event: { target: { value: string } }) => onChange(event.target.value),
          style: { ...inputStyle, fontFamily: WEB_SYSTEM_FONT, borderStyle: 'solid', boxSizing: 'border-box', width: '100%' },
        })
      ) : (
        <TextInput
          style={inputStyle}
          value={value}
          onChangeText={onChange}
          placeholder="YYYY-MM-DD"
          accessibilityLabel={accessibilityLabel}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
        />
      )}
    </Field>
  );
}
