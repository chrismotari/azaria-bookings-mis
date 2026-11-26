import { zodResolver } from '@hookform/resolvers/zod';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Text, View } from 'react-native';
import { z } from 'zod';

import { MODULE_LABELS } from '../../agency/modules';
import { api } from '../../api/client';
import { applyServerErrors } from '../../api/errors';
import { AgencyInfo, AppSettings } from '../../api/types';
import { Button } from '../../components/Button';
import { FieldGrid, FormError } from '../../components/Field';
import { FormSection } from '../../components/FormSection';
import { IconName } from '../../components/Icon';
import { SettingsLayout, SettingsSectionItem } from '../../components/SettingsLayout';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { TextField } from '../../components/TextField';
import { AdminTabParamList, SettingsSection } from '../../navigation/types';
import { colors, createStyles, font, space, weight } from '../../theme';
import { IntegrationsSection } from './IntegrationsSection';
import { MailServerSection } from './MailServerSection';
import { ThemeSection } from './ThemeSection';

const SECTIONS: SettingsSectionItem<SettingsSection>[] = [
  { key: 'general', label: 'General', icon: 'business-outline' },
  { key: 'bookings', label: 'Bookings and payments', icon: 'card-outline' },
  { key: 'notifications', label: 'Notifications', icon: 'notifications-outline' },
  { key: 'email', label: 'Email sending', icon: 'mail-outline' },
  { key: 'theme', label: 'Theme', icon: 'color-palette-outline' },
  { key: 'integrations', label: 'Integrations', icon: 'git-network-outline' },
  { key: 'billing', label: 'Billing', icon: 'document-text-outline' },
  { key: 'support', label: 'Support', icon: 'chatbubbles-outline' },
];

const SETTINGS_KEY = ['admin', 'settings'];

type Props = BottomTabScreenProps<AdminTabParamList, 'AdminSettings'>;

export function AdminSettingsScreen({ navigation, route }: Props) {
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
  return (
    <SettingsLayout
      sections={SECTIONS.filter((item) => item.key !== 'integrations' || settings.data.modules.includes('flights'))}
      current={route.params?.section}
      onOpen={(section) => navigation.setParams({ section })}
      renderSection={(section) => <Section section={section} settings={settings.data} />}
    />
  );
}

function Section({ section, settings }: { section: SettingsSection; settings: AppSettings }) {
  const navigation = useNavigation();
  const agency = useQuery({
    queryKey: ['agency'],
    queryFn: async () => (await api.get<AgencyInfo>('/agency')).data,
  });
  const name = agency.data?.name ?? '';
  switch (section) {
    case 'general':
      return <General agency={agency.data} />;
    case 'bookings':
      return <BookingsForm settings={settings} />;
    case 'notifications':
      return <NotificationsForm settings={settings} />;
    case 'email':
      return <MailServerSection base="/admin/mail-server" agencyName={name} repliesTo="your notification email" />;
    case 'theme':
      return <ThemeSection current={settings.theme} settingsKey={SETTINGS_KEY} />;
    case 'integrations':
      return <IntegrationsSection />;
    case 'billing':
      return (
        <LinkSection
          title="Billing"
          description="Your agency's plans with Dira Manifest and their invoices."
          button="View billing"
          icon="document-text-outline"
          onPress={() => navigation.navigate('AdminTabs', { screen: 'AdminBilling' })}
        />
      );
    case 'support':
      return (
        <LinkSection
          title="Support"
          description="Chat with Dira Manifest, the platform: questions, plans and billing. Replies also come by email."
          button="Open support"
          icon="chatbubbles-outline"
          onPress={() => navigation.navigate('AdminTabs', { screen: 'AdminSupport' })}
        />
      );
  }
}

function General({ agency }: { agency: AgencyInfo | undefined }) {
  if (!agency) {
    return <LoadingState />;
  }
  return (
    <FormSection title="General" description="Set by Dira Manifest. Ask us through Support to change them.">
      <Detail label="Name" value={agency.name} />
      <Detail label="Code" value={agency.code} />
      <Detail label="App address" value={agency.app_address} />
      <Detail label="Modules" value={agency.modules.map((module) => MODULE_LABELS[module]).join(', ')} />
    </FormSection>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function LinkSection(props: {
  title: string;
  description: string;
  button: string;
  icon: IconName;
  onPress: () => void;
}) {
  return (
    <FormSection title={props.title} description={props.description}>
      <View style={styles.start}>
        <Button title={props.button} variant="secondary" icon={props.icon} onPress={props.onPress} />
      </View>
    </FormSection>
  );
}

const HOURS = /^[1-9]\d{0,4}$/;

// Mirrors the server's rules.
const bookingsSchema = z.object({
  payment_instructions: z.string(),
  payment_hold_hours: z.string().trim().regex(HOURS, 'Enter a whole number of hours, at least 1.'),
  reminder_hours_before: z.string().trim().regex(HOURS, 'Enter a whole number of hours, at least 1.'),
});

const notificationsSchema = z.object({ admin_notification_email: z.email('Enter a valid email address.') });

/** Saves part of the app settings and keeps the cached settings in step. */
function useSaveSettings() {
  const queryClient = useQueryClient();
  return async (values: Partial<AppSettings>) => {
    const { data } = await api.patch<AppSettings>('/admin/settings', values);
    queryClient.setQueryData(SETTINGS_KEY, data);
    return data;
  };
}

function SaveRow({ saved, loading, onPress }: { saved: boolean; loading: boolean; onPress: () => void }) {
  return (
    <View style={styles.saveRow}>
      <Button title="Save" onPress={onPress} loading={loading} />
      {saved ? <Text style={styles.saved}>Saved.</Text> : null}
    </View>
  );
}

function BookingsForm({ settings }: { settings: AppSettings }) {
  const save = useSaveSettings();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const toValues = (data: AppSettings) => ({
    payment_instructions: data.payment_instructions,
    payment_hold_hours: String(data.payment_hold_hours),
    reminder_hours_before: String(data.reminder_hours_before),
  });
  const { control, handleSubmit, setError, reset, formState } = useForm<z.infer<typeof bookingsSchema>>({
    resolver: zodResolver(bookingsSchema),
    defaultValues: toValues(settings),
  });
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setSaved(false);
    try {
      const data = await save({
        payment_instructions: values.payment_instructions.trim(),
        payment_hold_hours: Number(values.payment_hold_hours),
        reminder_hours_before: Number(values.reminder_hours_before),
      });
      reset(toValues(data));
      setSaved(true);
    } catch (error) {
      setFormError(
        applyServerErrors(error, setError, ['payment_instructions', 'payment_hold_hours', 'reminder_hours_before']),
      );
    }
  });
  const text = (name: keyof z.infer<typeof bookingsSchema>, label: string, extra: object = {}) => (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          label={label}
          value={field.value}
          onChangeText={(value) => {
            setSaved(false);
            field.onChange(value);
          }}
          onBlur={field.onBlur}
          error={fieldState.error?.message}
          {...extra}
        />
      )}
    />
  );
  return (
    <FormSection
      title="Bookings and payments"
      description="Payment instructions go to customers when you confirm availability and in payment reminders. After you confirm, the customer has the hold period to pay before the booking expires."
    >
      {text('payment_instructions', 'Payment instructions', {
        placeholder: 'e.g. M-Pesa paybill number and account, or bank details',
        multiline: true,
        numberOfLines: 6,
      })}
      {!settings.payment_instructions.trim() ? (
        <Text style={styles.warning}>Add payment instructions before confirming any booking.</Text>
      ) : null}
      <FieldGrid columns={2}>
        {text('payment_hold_hours', 'Payment hold (hours)', { keyboardType: 'number-pad' })}
        {text('reminder_hours_before', 'Reminder (hours before deadline)', { keyboardType: 'number-pad' })}
      </FieldGrid>
      <FormError message={formError} />
      <SaveRow saved={saved} loading={formState.isSubmitting} onPress={onSubmit} />
    </FormSection>
  );
}

function NotificationsForm({ settings }: { settings: AppSettings }) {
  const save = useSaveSettings();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { control, handleSubmit, setError, reset, formState } = useForm<z.infer<typeof notificationsSchema>>({
    resolver: zodResolver(notificationsSchema),
    defaultValues: { admin_notification_email: settings.admin_notification_email },
  });
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setSaved(false);
    try {
      const data = await save({ admin_notification_email: values.admin_notification_email.trim() });
      reset({ admin_notification_email: data.admin_notification_email });
      setSaved(true);
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['admin_notification_email']));
    }
  });
  return (
    <FormSection
      title="Notifications"
      description="New requests, bookings, reviews and support messages are emailed here. Customers' replies to your emails come here too when you use Dira Manifest's mail server."
    >
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
      <FormError message={formError} />
      <SaveRow saved={saved} loading={formState.isSubmitting} onPress={onSubmit} />
    </FormSection>
  );
}

const styles = createStyles(() => ({
  detail: { gap: 2 },
  detailLabel: { fontSize: font.small, color: colors.muted },
  detailValue: { fontSize: font.body, color: colors.text },
  start: { alignItems: 'flex-start' },
  warning: { color: colors.danger },
  saved: { color: colors.success, fontWeight: weight.semibold },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
}));
