import { createElement } from 'react';
import { Platform } from 'react-native';

import { WEB_SYSTEM_FONT } from '../theme';
import { Field, useInputStyle } from './Field';
import { OptionChips } from './OptionChips';

type Props<T extends string> = {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  error?: string;
  accessibilityLabel?: string;
};

/** A compact single choice: the browser's select on web, chips on native. */
export function SelectField<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
  accessibilityLabel = label,
}: Props<T>) {
  const input = useInputStyle(error);
  if (Platform.OS !== 'web') {
    return <OptionChips label={label} options={options} value={value} onChange={onChange} error={error} />;
  }
  return (
    <Field label={label} error={error}>
      {createElement(
        'select',
        {
          value,
          'aria-label': accessibilityLabel,
          onChange: (event: { target: { value: string } }) => onChange(event.target.value as T),
          style: {
            ...input,
            fontFamily: WEB_SYSTEM_FONT,
            borderStyle: 'solid',
            boxSizing: 'border-box',
            width: '100%',
          },
        },
        options.map((option) => createElement('option', { key: option.value, value: option.value }, option.label)),
      )}
    </Field>
  );
}
