import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text } from 'react-native';
import { z } from 'zod';

import { api } from '../../api/client';
import { applyServerErrors } from '../../api/errors';
import { PlatformSettings } from '../../api/types';
import { Button } from '../../components/Button';
import { FieldGrid, FormError } from '../../components/Field';
import { FormFooter, FormSection } from '../../components/FormSection';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { TextField } from '../../components/TextField';
import { colors, font, weight } from '../../theme';
import { ExchangeRates } from './ExchangeRates';

const DAYS = /^\d{1,3}$/;

// Mirrors the server's rules.
const schema = z.object({
  issuer_details: z.string(),
  payment_instructions: z.string(),
  invoice_due_days: z.string().trim().regex(DAYS, 'Enter a whole number of days.'),
  invoice_lead_days: z.string().trim().regex(DAYS, 'Enter a whole number of days.'),
  billing_contact_email: z.union([z.literal(''), z.email('Enter a valid email address.')]),
  support_email: z.union([z.literal(''), z.email('Enter a valid email address.')]),
});

type FormValues = z.infer<typeof schema>;

const FIELDS = [
  'issuer_details',
  'payment_instructions',
  'invoice_due_days',
  'invoice_lead_days',
  'billing_contact_email',
  'support_email',
] as const;

const SETTINGS_KEY = ['platform', 'settings'];

export function PlatformSettingsScreen() {
  const settings = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async () => (await api.get<PlatformSettings>('/platform/settings')).data,
  });
  if (settings.isPending) {
    return <LoadingState />;
  }
  if (settings.isError) {
    return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />;
  }
  return <SettingsForm settings={settings.data} />;
}

function toValues(settings: PlatformSettings): FormValues {
  return {
    issuer_details: settings.issuer_details,
    payment_instructions: settings.payment_instructions,
    invoice_due_days: String(settings.invoice_due_days),
    invoice_lead_days: String(settings.invoice_lead_days),
    billing_contact_email: settings.billing_contact_email,
    support_email: settings.support_email,
  };
}

function SettingsForm({ settings }: { settings: PlatformSettings }) {
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
      const { data } = await api.patch<PlatformSettings>('/platform/settings', {
        issuer_details: values.issuer_details.trim(),
        payment_instructions: values.payment_instructions.trim(),
        invoice_due_days: Number(values.invoice_due_days),
        invoice_lead_days: Number(values.invoice_lead_days),
        billing_contact_email: values.billing_contact_email.trim(),
        support_email: values.support_email.trim(),
      });
      queryClient.setQueryData(SETTINGS_KEY, data);
      reset(toValues(data));
      setSaved(true);
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS));
    }
  });

  const field = (
    name: (typeof FIELDS)[number],
    label: string,
    options: {
      multiline?: boolean;
      numeric?: boolean;
      placeholder?: string;
    } = {},
  ) => (
    <Controller
      control={control}
      name={name}
      render={({ field: input, fieldState }) => (
        <TextField
          label={label}
          value={input.value}
          placeholder={options.placeholder}
          onChangeText={(value) => {
            setSaved(false);
            input.onChange(value);
          }}
          onBlur={input.onBlur}
          error={fieldState.error?.message}
          multiline={options.multiline}
          numberOfLines={options.multiline ? 5 : undefined}
          keyboardType={options.numeric ? 'number-pad' : name.endsWith('_email') ? 'email-address' : 'default'}
          autoCapitalize={name.endsWith('_email') ? 'none' : 'sentences'}
        />
      )}
    />
  );

  return (
    <Screen maxWidth={760}>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.muted}>Billing for every agency. Amounts are in {settings.currency}.</Text>
      <FormSection title="On every invoice" description="Printed on the PDF and repeated in the invoice email.">
        {field('issuer_details', 'Issuer details', {
          multiline: true,
          placeholder: "The platform's name and address, e.g. company name, street, city, tax number",
        })}
        {field('payment_instructions', 'Payment instructions', {
          multiline: true,
          placeholder: 'e.g. bank details or M-Pesa paybill, and to quote the invoice number',
        })}
        {!settings.payment_instructions.trim() ? (
          <Text style={styles.warning}>Add payment instructions so agencies know how to pay their invoices.</Text>
        ) : null}
      </FormSection>
      <FormSection
        title="Timing"
        description="Invoices are issued the lead days before a period starts and are due the due days after they are issued. An agency is suspended once an invoice is more than a month past its due date."
      >
        <FieldGrid columns={2}>
          {field('invoice_lead_days', 'Issue (days before the period)', {
            numeric: true,
          })}
          {field('invoice_due_days', 'Due (days after issue)', {
            numeric: true,
          })}
        </FieldGrid>
      </FormSection>
      <FormSection
        title="Billing contact"
        description="Shown to agencies on their Billing screen, in emails and when suspended for non-payment."
      >
        {field('billing_contact_email', 'Billing contact email')}
      </FormSection>
      <FormSection
        title="Support"
        description="New chats and messages on the platform's desk (from visitors, plan enquiries and agencies' admins) are emailed here; answer them in Chats."
      >
        {field('support_email', 'Support email')}
        {!settings.support_email ? (
          <Text style={styles.warning}>Add a support email to be told about new chats.</Text>
        ) : null}
      </FormSection>
      <FormError message={formError} />
      {saved && !formState.isDirty ? <Text style={styles.saved}>Settings saved.</Text> : null}
      <FormFooter>
        <Button
          title="Save settings"
          onPress={onSubmit}
          loading={formState.isSubmitting}
          disabled={!formState.isDirty}
        />
      </FormFooter>
      <ExchangeRates />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  muted: { color: colors.muted },
  warning: { color: colors.warningText, fontWeight: weight.semibold },
  saved: { color: colors.successText, fontWeight: weight.semibold },
});
