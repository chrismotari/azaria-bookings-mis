import { TextInput, TextInputProps } from 'react-native';

import { Field, inputStyle } from './Field';

type Props = Omit<TextInputProps, 'style'> & { label: string; error?: string };

export function TextField({ label, error, ...inputProps }: Props) {
  return (
    <Field label={label} error={error}>
      <TextInput style={inputStyle} placeholderTextColor="#98a2ad" accessibilityLabel={label} {...inputProps} />
    </Field>
  );
}
