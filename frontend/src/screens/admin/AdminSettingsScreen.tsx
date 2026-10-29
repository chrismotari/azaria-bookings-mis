import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { api } from '../../api/client';
import { applyServerErrors } from '../../api/errors';
import { AppSettings } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FieldGrid, FormError } from '../../components/Field';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { TextField } from '../../components/TextField';
import { colors } from '../../theme';

const HOURS = /^[1-9]\d{0,4}$/;

// Mirrors the server's rules.
const schema = z.object({
  payment_instructions: z.string(),
  payment_hold_hours: z.string().trim().regex(HOURS, 'Enter a whole number of hours, at least 1.'),
  reminder_hours_before: z.string().trim().regex(HOURS, 'Enter a whole number of hours, at least 1.'),
  admin_notification_email: z.email('Enter a valid email address.'),
});

type FormValues = z.infer<typeof schema>;

const FIELDS = ['payment_instructions', 'payment_hold_hours', 'reminder_hours_before', 'admin_notification_email'] as const;

const SETTINGS_KEY = ['admin', 'settings'];

export function AdminSettingsScreen() {
  const settings = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async () => (await api.get<AppSettings>('/admin/settings')).data,
  });

  if (settings.isPending) {
    return <LoadingState />;
  }
  if (settings.isError) {
    return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />;
  }
  return <SettingsForm settings={settings.data} />;
}

function toValues(settings: AppSettings): FormValues {
  return {
    payment_instructions: settings.payment_instructions,
    payment_hold_hours: String(settings.payment_hold_hours),
    reminder_hours_before: String(settings.reminder_hours_before),
    admin_notification_email: settings.admin_notification_email,
  };
}

function SettingsForm({ settings }: { settings: AppSettings }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { control, handleSubmit, setError, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: toValues(settings),
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setSaved(false);
    try {
      const { data } = await api.patch<AppSettings>('/admin/settings', {
        payment_instructions: values.payment_instructions.trim(),
        payment_hold_hours: Number(values.payment_hold_hours),
        reminder_hours_before: Number(values.reminder_hours_before),
        admin_notification_email: values.admin_notification_email.trim(),
      });
      queryClient.setQueryData(SETTINGS_KEY, data);
      reset(toValues(data));
      setSaved(true);
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS));
    }
  });

  return (
    <Screen maxWidth={760}>
      <Text style={styles.title}>Settings</Text>
      <Card>
        <Controller
          control={control}
          name="payment_instructions"
          render={({ field, fieldState }) => (
            <TextField
              label="Payment instructions"
              placeholder="e.g. M-Pesa paybill number and account, or bank details"
              value={field.value}
              onChangeText={(value) => {
                setSaved(false);
                field.onChange(value);
              }}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              multiline
              numberOfLines={6}
            />
          )}
        />
        {!settings.payment_instructions.trim() ? (
          <Text style={styles.warning}>Add payment instructions before confirming any booking.</Text>
        ) : null}
        <Text style={styles.muted}>Sent to customers when you confirm availability and in payment reminders.</Text>
        <FieldGrid>
          <Controller
            control={control}
            name="payment_hold_hours"
            render={({ field, fieldState }) => (
              <TextField
                label="Payment hold (hours)"
                value={field.value}
                onChangeText={(value) => {
                  setSaved(false);
                  field.onChange(value);
                }}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                keyboardType="number-pad"
              />
            )}
          />
          <Controller
            control={control}
            name="reminder_hours_before"
            render={({ field, fieldState }) => (
              <TextField
                label="Reminder (hours before deadline)"
                value={field.value}
                onChangeText={(value) => {
                  setSaved(false);
                  field.onChange(value);
                }}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                keyboardType="number-pad"
              />
            )}
          />
        </FieldGrid>
        <Text style={styles.muted}>
          After you confirm availability, the customer has the hold period to pay before the booking expires.
        </Text>
        <Controller
          control={control}
          name="admin_notification_email"
          render={({ field, fieldState }) => (
            <TextField
              label="Notification email"
              value={field.value}
              onChangeText={(value) => {
                setSaved(false);
                field.onChange(value);
              }}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          )}
        />
        <Text style={styles.muted}>New requests and bookings are emailed here.</Text>
        <FormError message={formError} />
        {saved ? <Text style={styles.saved}>Settings saved.</Text> : null}
        <View style={styles.actions}>
          <Button title="Save settings" onPress={onSubmit} loading={formState.isSubmitting} />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted, fontSize: 13 },
  warning: { color: colors.danger },
  saved: { color: colors.success, fontWeight: '600' },
  actions: { flexDirection: 'row' },
});
