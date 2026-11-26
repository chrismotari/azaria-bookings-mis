import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Text, View } from 'react-native';
import { z } from 'zod';

import { api } from '../../api/client';
import { applyServerErrors, errorMessage } from '../../api/errors';
import { MailSecurity, MailServer } from '../../api/types';
import { Button } from '../../components/Button';
import { useConfirm } from '../../components/ConfirmDialog';
import { FieldGrid, FormError } from '../../components/Field';
import { FormSection } from '../../components/FormSection';
import { SelectField } from '../../components/SelectField';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { TextField } from '../../components/TextField';
import { colors, createStyles, font, space, weight } from '../../theme';
import { formatDateTime } from '../../utils/format';

const SECURITY: { value: MailSecurity; label: string }[] = [
  { value: 'starttls', label: 'STARTTLS' },
  { value: 'ssl', label: 'SSL' },
  { value: 'none', label: 'None' },
];

const FIELDS = ['host', 'port', 'security', 'username', 'password', 'from_email', 'from_name'] as const;

// Mirrors the server's rules; a stored password may stay blank.
function schemaFor(hasPassword: boolean) {
  return z
    .object({
      host: z.string().trim().min(1, "Enter the server's host."),
      port: z
        .string()
        .trim()
        .regex(/^\d{1,5}$/, 'Enter a port between 1 and 65535.')
        .refine((value) => Number(value) >= 1 && Number(value) <= 65535, 'Enter a port between 1 and 65535.'),
      security: z.enum(['starttls', 'ssl', 'none']),
      username: z.string().trim(),
      password: z.string(),
      from_email: z.email('Enter a valid email address.'),
      from_name: z.string().trim().max(80, 'At most 80 characters.'),
    })
    .superRefine((values, context) => {
      if (values.username && !values.password && !hasPassword) {
        context.addIssue({ code: 'custom', path: ['password'], message: 'Enter the password for this username.' });
      }
      if (values.password && !values.username) {
        context.addIssue({ code: 'custom', path: ['username'], message: 'Enter the username for this password.' });
      }
    });
}

type FormValues = z.infer<ReturnType<typeof schemaFor>>;

function toValues(server: MailServer): FormValues {
  return {
    host: server.host,
    port: String(server.port),
    security: server.security,
    username: server.username,
    password: '',
    from_email: server.from_email,
    from_name: server.from_name,
  };
}

type Props = {
  /** The API path: the agency's own (/admin/mail-server) or the owner's for an agency. */
  base: string;
  agencyName: string;
  /** Who customers' replies reach without a server, e.g. "your notification email". */
  repliesTo: string;
};

/** Email sending: the agency's own SMTP server, or Dira Manifest's in the agency's name. */
export function MailServerSection({ base, agencyName, repliesTo }: Props) {
  // Kept here: the form starts afresh when the server is saved or removed.
  const [notice, setNotice] = useState<Notice>(null);
  const server = useQuery({
    queryKey: ['mail-server', base],
    queryFn: async () => (await api.get<MailServer>(base)).data,
  });
  return (
    <FormSection
      title="Email sending"
      description="Use the SMTP details from your email provider (for example Google Workspace, Microsoft 365, Zoho or your host). Port 587 uses STARTTLS; 465 uses SSL."
    >
      {server.isPending ? (
        <LoadingState />
      ) : server.isError ? (
        <ErrorState error={server.error} onRetry={() => server.refetch()} />
      ) : (
        <MailServerForm
          key={`${server.data.in_use}-${server.data.has_password}`}
          base={base}
          server={server.data}
          agencyName={agencyName}
          repliesTo={repliesTo}
          notice={notice}
          setNotice={setNotice}
        />
      )}
    </FormSection>
  );
}

type Notice = { text: string; ok: boolean } | null;

type FormProps = Props & { server: MailServer; notice: Notice; setNotice: (notice: Notice) => void };

function MailServerForm({ base, server, agencyName, repliesTo, notice, setNotice }: FormProps) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [formError, setFormError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { control, handleSubmit, setError, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(schemaFor(server.has_password)),
    defaultValues: toValues(server),
  });

  const store = (data: MailServer) => queryClient.setQueryData(['mail-server', base], data);

  const onSave = handleSubmit(async (values) => {
    setFormError(null);
    setNotice(null);
    try {
      const { data } = await api.put<MailServer>(base, { ...values, port: Number(values.port) });
      store(data);
      reset(toValues(data));
      setNotice({ text: 'Mail server saved.', ok: true });
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS));
    }
  });

  const onTest = async () => {
    setNotice(null);
    setFormError(null);
    setTesting(true);
    try {
      const { data } = await api.post<{ sent: boolean; error: string }>(`${base}/test`);
      setNotice(data.sent ? { text: 'Test email sent. Check your inbox.', ok: true } : { text: data.error, ok: false });
      await queryClient.invalidateQueries({ queryKey: ['mail-server', base] });
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setTesting(false);
    }
  };

  const onRemove = async () => {
    const ok = await confirm({
      title: 'Remove this mail server?',
      message: "Emails will go through Dira Manifest's server again.",
      confirmLabel: 'Remove server',
      tone: 'danger',
    });
    if (!ok) {
      return;
    }
    setRemoving(true);
    try {
      const { data } = await api.delete<MailServer>(base);
      store(data);
      reset(toValues(data));
      setNotice(null);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setRemoving(false);
    }
  };

  const field = (name: (typeof FIELDS)[number], label: string, extra: object = {}) => (
    <Controller
      control={control}
      name={name}
      render={({ field: input, fieldState }) => (
        <TextField
          label={label}
          value={String(input.value)}
          onChangeText={input.onChange}
          onBlur={input.onBlur}
          error={fieldState.error?.message}
          autoCapitalize="none"
          {...extra}
        />
      )}
    />
  );

  return (
    <View style={styles.body}>
      <View style={styles.status}>
        {server.in_use ? (
          <Text style={styles.statusText}>
            Using {agencyName}'s own server ({server.host}).
          </Text>
        ) : (
          <Text style={styles.statusText}>
            Using Dira Manifest's server. Emails go out in {agencyName}'s name, and replies go to {repliesTo}.
          </Text>
        )}
        {server.last_failure_at ? (
          <Text style={styles.failure}>
            Last attempt failed {formatDateTime(server.last_failure_at)}: {server.last_failure}
          </Text>
        ) : server.last_success_at ? (
          <Text style={styles.muted}>Last sent {formatDateTime(server.last_success_at)}</Text>
        ) : null}
      </View>
      <FieldGrid columns={2}>
        {field('host', 'Host', { placeholder: 'smtp.example.com' })}
        {field('port', 'Port', { keyboardType: 'number-pad' })}
      </FieldGrid>
      <Controller
        control={control}
        name="security"
        render={({ field: input, fieldState }) => (
          <SelectField
            label="Security"
            options={SECURITY}
            value={input.value}
            onChange={input.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <FieldGrid columns={2}>
        {field('username', 'Username')}
        {field('password', 'Password', {
          secureTextEntry: true,
          placeholder: server.has_password ? 'Saved; leave blank to keep it' : '',
        })}
      </FieldGrid>
      <FieldGrid columns={2}>
        {field('from_email', 'From address', { keyboardType: 'email-address', placeholder: 'bookings@youragency.com' })}
        {field('from_name', 'From name', { placeholder: agencyName, autoCapitalize: 'words' })}
      </FieldGrid>
      <FormError message={formError} />
      {notice ? <Text style={notice.ok ? styles.saved : styles.failure}>{notice.text}</Text> : null}
      <View style={styles.actions}>
        <Button title="Save" onPress={onSave} loading={formState.isSubmitting} />
        <Button
          title="Send test email"
          variant="secondary"
          icon="paper-plane-outline"
          onPress={onTest}
          loading={testing}
          disabled={!server.in_use || formState.isDirty}
        />
        {server.in_use ? <Button title="Remove server" variant="danger" onPress={onRemove} loading={removing} /> : null}
      </View>
    </View>
  );
}

const styles = createStyles(() => ({
  body: { gap: space.md },
  status: { gap: space.xs },
  statusText: { fontSize: font.body, color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
  failure: { fontSize: font.small, color: colors.danger },
  saved: { color: colors.success, fontWeight: weight.semibold },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
}));
