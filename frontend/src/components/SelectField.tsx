import { createElement } from 'react';
import { Platform } from 'react-native';

import { Field, inputStyle } from './Field';
import { OptionChips } from './OptionChips';

type Props<T extends string> = {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
};

/** A compact single choice: the browser's select on web, chips on native. */
export function SelectField<T extends string>({ label, options, value, onChange }: Props<T>) {
  if (Platform.OS !== 'web') {
    return <OptionChips label={label} options={options} value={value} onChange={onChange} />;
  }
  return (
    <Field label={label}>
      {createElement(
        'select',
        {
          value,
          'aria-label': label,
          onChange: (event: { target: { value: string } }) => onChange(event.target.value as T),
          style: { ...inputStyle, fontFamily: 'inherit', borderStyle: 'solid', boxSizing: 'border-box', width: '100%' },
        },
        options.map((option) => createElement('option', { key: option.value, value: option.value }, option.label)),
      )}
    </Field>
  );
}
