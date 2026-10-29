import { zodResolver } from '@hookform/resolvers/zod';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text } from 'react-native';
import { z } from 'zod';

import { errorMessage } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import { continueAfterSignIn } from '../../auth/gate';
import { Button } from '../../components/Button';
import { FormError } from '../../components/Field';
import { TextField } from '../../components/TextField';
import { RootStackParamList } from '../../navigation/types';
import { colors } from '../../theme';
import { AuthLayout } from './AuthLayout';

const schema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

type FormValues = z.infer<typeof schema>;

export function LoginScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Login'>) {
  const { login } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFormError(null);
    try {
      continueAfterSignIn(await login(email, password));
    } catch (error) {
      setFormError(
        isAxiosError(error) && error.response?.status === 401 ? 'Incorrect email or password.' : errorMessage(error),
      );
    }
  });

  return (
    <AuthLayout title="Sign in">
      {route.params?.passwordReset ? (
        <Text style={styles.notice}>Your password has been reset. Sign in with your new password.</Text>
      ) : null}
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
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <TextField
            label="Password"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            secureTextEntry
            autoComplete="current-password"
            onSubmitEditing={() => onSubmit()}
          />
        )}
      />
      <FormError message={formError} />
      <Button title="Sign in" onPress={onSubmit} loading={formState.isSubmitting} />
      <Button title="Forgot password?" variant="link" onPress={() => navigation.navigate('ForgotPassword')} />
      <Button title="New here? Create an account" variant="link" onPress={() => navigation.navigate('Register')} />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  notice: { color: colors.success },
});
