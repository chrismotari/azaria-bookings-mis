import { zodResolver } from '@hookform/resolvers/zod';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text } from 'react-native';
import { z } from 'zod';

import { api } from '../../api/client';
import { applyServerErrors } from '../../api/errors';
import { Button } from '../../components/Button';
import { FormError } from '../../components/Field';
import { TextField } from '../../components/TextField';
import { RootStackParamList } from '../../navigation/types';
import { colors } from '../../theme';
import { AuthLayout } from './AuthLayout';
import { passwordSchema } from './passwordSchema';

const schema = z
  .object({ new_password: passwordSchema, confirm: z.string() })
  .refine((values) => values.new_password === values.confirm, {
    message: 'The passwords do not match.',
    path: ['confirm'],
  });

type FormValues = z.infer<typeof schema>;

export function ResetPasswordScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'ResetPassword'>) {
  const uid = route.params?.uid;
  const token = route.params?.token;
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { new_password: '', confirm: '' },
  });

  const onSubmit = handleSubmit(async ({ new_password }) => {
    setFormError(null);
    try {
      await api.post('/auth/password-reset-confirm', { uid, token, new_password });
      navigation.reset({ index: 0, routes: [{ name: 'Login', params: { passwordReset: true } }] });
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['new_password']));
    }
  });

  if (!uid || !token) {
    return (
      <AuthLayout title="Set a new password">
        <Text style={styles.error}>This reset link is incomplete. Request a new one.</Text>
        <Button title="Request a new link" onPress={() => navigation.navigate('ForgotPassword')} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Set a new password">
      <Controller
        control={control}
        name="new_password"
        render={({ field, fieldState }) => (
          <TextField
            label="New password"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            secureTextEntry
            autoComplete="new-password"
          />
        )}
      />
      <Controller
        control={control}
        name="confirm"
        render={({ field, fieldState }) => (
          <TextField
            label="Confirm new password"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            secureTextEntry
            autoComplete="new-password"
            onSubmitEditing={() => onSubmit()}
          />
        )}
      />
      <FormError message={formError} />
      <Button title="Set password" onPress={onSubmit} loading={formState.isSubmitting} />
      <Button title="Request a new link" variant="link" onPress={() => navigation.navigate('ForgotPassword')} />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger },
});
