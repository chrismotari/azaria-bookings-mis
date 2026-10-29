import { zodResolver } from '@hookform/resolvers/zod';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { applyServerErrors } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import { continueAfterSignIn } from '../../auth/gate';
import { Button } from '../../components/Button';
import { FormError } from '../../components/Field';
import { TextField } from '../../components/TextField';
import { RootStackParamList } from '../../navigation/types';
import { AuthLayout } from './AuthLayout';
import { passwordSchema } from './passwordSchema';

const schema = z.object({
  full_name: z.string().trim().min(1, 'Enter your full name.').max(150),
  email: z.email('Enter a valid email address.'),
  phone: z.string().trim().min(1, 'Enter your phone number.').max(30),
  password: passwordSchema,
});

type FormValues = z.infer<typeof schema>;

const FIELDS = ['full_name', 'email', 'phone', 'password'] as const;

const LABELS: Record<(typeof FIELDS)[number], string> = {
  full_name: 'Full name',
  email: 'Email',
  phone: 'Phone',
  password: 'Password',
};

export function RegisterScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Register'>) {
  const { register } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: '', email: '', phone: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      continueAfterSignIn(await register(values));
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS));
    }
  });

  return (
    <AuthLayout title="Create an account">
      {FIELDS.map((name) => (
        <Controller
          key={name}
          control={control}
          name={name}
          render={({ field, fieldState }) => (
            <TextField
              label={LABELS[name]}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              secureTextEntry={name === 'password'}
              autoCapitalize={name === 'full_name' ? 'words' : 'none'}
              keyboardType={name === 'email' ? 'email-address' : name === 'phone' ? 'phone-pad' : 'default'}
              autoComplete={
                name === 'full_name' ? 'name' : name === 'email' ? 'email' : name === 'phone' ? 'tel' : 'new-password'
              }
            />
          )}
        />
      ))}
      <FormError message={formError} />
      <Button title="Create account" onPress={onSubmit} loading={formState.isSubmitting} />
      <Button title="Already have an account? Sign in" variant="link" onPress={() => navigation.navigate('Login')} />
    </AuthLayout>
  );
}
