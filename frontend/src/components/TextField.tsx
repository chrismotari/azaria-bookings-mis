import { TextInput, TextInputProps } from 'react-native';

import { colors } from '../theme';
import { Field, useInputStyle } from './Field';

type Props = Omit<TextInputProps, 'style'> & { label: string; error?: string };

export function TextField({ label, error, ...inputProps }: Props) {
  const input = useInputStyle(error);
  return (
    <Field label={label} error={error}>
      <TextInput style={input} placeholderTextColor={colors.placeholder} accessibilityLabel={label} {...inputProps} />
    </Field>
  );
}
