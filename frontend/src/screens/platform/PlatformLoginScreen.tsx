import { zodResolver } from '@hookform/resolvers/zod';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text } from 'react-native';
import { z } from 'zod';

import { errorMessage } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FormError } from '../../components/Field';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { colors, font, space, weight } from '../../theme';

const schema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

type FormValues = z.infer<typeof schema>;

/** The system owner's sign-in. No registration or password reset here: accounts are made with createsuperuser. */
export function PlatformLoginScreen() {
  const { login } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  // Signing in switches to the platform's screens by itself.
  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFormError(null);
    try {
      await login(email, password);
    } catch (error) {
      setFormError(
        isAxiosError(error) && error.response?.status === 401 ? 'Incorrect email or password.' : errorMessage(error),
      );
    }
  });

  return (
    <Screen maxWidth={440}>
      <Card>
        <Text style={styles.title}>Platform sign in</Text>
        <Text style={styles.muted}>For the system owner, to manage agencies.</Text>
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
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  muted: { color: colors.muted, marginBottom: space.xs },
});
