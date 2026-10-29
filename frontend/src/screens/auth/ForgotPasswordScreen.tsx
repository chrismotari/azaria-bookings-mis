import { zodResolver } from '@hookform/resolvers/zod';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text } from 'react-native';
import { z } from 'zod';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { Button } from '../../components/Button';
import { FormError } from '../../components/Field';
import { TextField } from '../../components/TextField';
import { RootStackParamList } from '../../navigation/types';
import { colors } from '../../theme';
import { AuthLayout } from './AuthLayout';

const schema = z.object({ email: z.email('Enter a valid email address.') });

type FormValues = z.infer<typeof schema>;

export function ForgotPasswordScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'ForgotPassword'>) {
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const { data } = await api.post<{ detail: string }>('/auth/password-reset', values);
      setSentMessage(data.detail);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  return (
    <AuthLayout title="Reset your password">
      {sentMessage ? (
        <Text style={styles.notice}>{sentMessage}</Text>
      ) : (
        <>
          <Text style={styles.help}>Enter your account email and we will send you a link to set a new password.</Text>
          <Controller
            control={control}
            name="email"
            render={({ field, fieldState }) => (
              <TextField
                label="Email"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                onSubmitEditing={() => onSubmit()}
              />
            )}
          />
          <FormError message={formError} />
          <Button title="Send reset link" onPress={onSubmit} loading={formState.isSubmitting} />
        </>
      )}
      <Button title="Back to sign in" variant="link" onPress={() => navigation.navigate('Login')} />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  help: { color: colors.muted },
  notice: { color: colors.success },
});
