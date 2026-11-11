import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { api } from '../../api/client';
import { applyServerErrors, errorMessage } from '../../api/errors';
import { Integration } from '../../api/types';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Field, FormError } from '../../components/Field';
import { FormSection } from '../../components/FormSection';
import { SegmentedControl } from '../../components/SegmentedControl';
import { SelectField } from '../../components/SelectField';
import { StatusChip } from '../../components/StatusChip';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { TextField } from '../../components/TextField';
import { colors, font, radius, space, weight } from '../../theme';
import { timeAgo } from '../../utils/format';
import { INTEGRATIONS_KEY, PROVIDERS, providerLabel, useIntegrations } from './gds';

const MODES: { value: Integration['mode']; label: string }[] = [
  { value: 'test', label: 'Test' },
  { value: 'live', label: 'Live' },
];

/** Settings › Integrations: the agency's fare providers. */
export function IntegrationsSection() {
  const integrations = useIntegrations();
  const [adding, setAdding] = useState(false);

  return (
    <FormSection
      title="Integrations"
      description="Fare providers your routes search. Add one to get the Routes tab; the app works fully without any. Credentials are stored encrypted and never shown again."
    >
      {integrations.isPending ? (
        <LoadingState />
      ) : integrations.isError ? (
        <ErrorState error={integrations.error} onRetry={() => integrations.refetch()} />
      ) : integrations.data.length === 0 ? (
        <Text style={styles.muted}>No integrations yet.</Text>
      ) : (
        <View style={styles.list}>
          {integrations.data.map((integration) => (
            <IntegrationRow key={integration.id} integration={integration} />
          ))}
        </View>
      )}
      <View style={styles.start}>
        <Button title="Add integration" variant="secondary" icon="add" onPress={() => setAdding(true)} />
      </View>
      {adding ? <IntegrationDialog onClose={() => setAdding(false)} /> : null}
    </FormSection>
  );
}

function testStatus(integration: Integration): { label: string; tone: 'success' | 'danger' | 'neutral' } {
  if (integration.last_test_ok === null) {
    return { label: 'Not tested', tone: 'neutral' };
  }
  return integration.last_test_ok ? { label: 'Connected', tone: 'success' } : { label: 'Test failed', tone: 'danger' };
}

function IntegrationRow({ integration }: { integration: Integration }) {
  const queryClient = useQueryClient();
  const [replacing, setReplacing] = useState(false);
  const save = (data: Integration) => {
    queryClient.setQueryData<Integration[]>(INTEGRATIONS_KEY, (list) =>
      list?.map((item) => (item.id === data.id ? data : item)),
    );
    return queryClient.invalidateQueries({ queryKey: ['admin', 'routes'] });
  };
  const test = useMutation({
    mutationFn: async () => (await api.post<Integration>(`/admin/integrations/${integration.id}/test`)).data,
    onSuccess: save,
  });
  const setActive = useMutation({
    mutationFn: async (is_active: boolean) =>
      (await api.patch<Integration>(`/admin/integrations/${integration.id}`, { is_active })).data,
    onSuccess: save,
  });
  const status = testStatus(integration);
  const error = test.error ?? setActive.error;

  return (
    <View style={styles.row}>
      <View style={styles.between}>
        <View style={styles.shrink}>
          <Text style={styles.name}>{integration.name}</Text>
          <Text style={styles.muted}>
            {providerLabel(integration.provider)} · {integration.mode === 'live' ? 'Live' : 'Test'} mode
          </Text>
        </View>
        <View style={styles.chips}>
          <StatusChip label={integration.is_active ? 'Enabled' : 'Disabled'} tone={integration.is_active ? 'info' : 'neutral'} />
          <StatusChip label={status.label} tone={status.tone} />
        </View>
      </View>
      {integration.last_tested_at ? (
        <Text style={[styles.small, integration.last_test_ok === false && styles.failed]}>
          Tested {timeAgo(integration.last_tested_at)}: {integration.last_test_message}
        </Text>
      ) : null}
      <FormError message={error ? errorMessage(error) : null} />
      <View style={styles.actions}>
        <Button title="Test" variant="secondary" icon="pulse-outline" onPress={() => test.mutate()} loading={test.isPending} />
        <Button
          title={integration.is_active ? 'Disable' : 'Enable'}
          variant="secondary"
          onPress={() => setActive.mutate(!integration.is_active)}
          loading={setActive.isPending}
        />
        <Button title="Replace credentials" variant="link" onPress={() => setReplacing(true)} />
      </View>
      {replacing ? <IntegrationDialog integration={integration} onClose={() => setReplacing(false)} /> : null}
    </View>
  );
}

const createSchema = z.object({
  provider: z.enum(['duffel']),
  name: z.string().trim().min(1, 'Enter a name.').max(100),
  mode: z.enum(['test', 'live']),
  access_token: z.string().trim().min(1, 'Enter the access token.'),
});

type FormValues = z.infer<typeof createSchema>;

/** Adds an integration, or (given one) replaces its credentials. */
function IntegrationDialog({ integration, onClose }: { integration?: Integration; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, formState } = useForm<FormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      provider: integration?.provider ?? 'duffel',
      name: integration?.name ?? 'Duffel',
      mode: integration?.mode ?? 'test',
      access_token: '',
    },
  });

  const onSave = handleSubmit(async (values) => {
    setFormError(null);
    const credentials = { access_token: values.access_token.trim() };
    try {
      if (integration) {
        await api.patch(`/admin/integrations/${integration.id}`, { credentials });
      } else {
        await api.post('/admin/integrations', {
          provider: values.provider,
          name: values.name.trim(),
          mode: values.mode,
          credentials,
        });
      }
      await queryClient.invalidateQueries({ queryKey: INTEGRATIONS_KEY });
      onClose();
    } catch (error) {
      const unplaced = applyServerErrors(error, setError, ['provider', 'name', 'mode']);
      setFormError(unplaced);
    }
  });

  return (
    <Dialog
      open
      title={integration ? `Replace credentials: ${integration.name}` : 'Add integration'}
      onClose={onClose}
      busy={formState.isSubmitting}
      error={formError}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={formState.isSubmitting} />
          <Button title={integration ? 'Save credentials' : 'Add integration'} onPress={onSave} loading={formState.isSubmitting} />
        </>
      }
    >
      {integration ? null : (
        <>
          <Controller
            control={control}
            name="provider"
            render={({ field }) => (
              <SelectField label="Provider" options={PROVIDERS} value={field.value} onChange={field.onChange} />
            )}
          />
          <Controller
            control={control}
            name="name"
            render={({ field, fieldState }) => (
              <TextField
                label="Name"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="mode"
            render={({ field }) => (
              <Field label="Mode">
                <SegmentedControl label="Mode" options={MODES} value={field.value} onChange={field.onChange} />
              </Field>
            )}
          />
        </>
      )}
      <Controller
        control={control}
        name="access_token"
        render={({ field, fieldState }) => (
          <TextField
            label={integration ? 'New access token' : 'Access token'}
            placeholder="duffel_test_…"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
        )}
      />
      <Text style={styles.small}>
        Create an access token in your Duffel dashboard (Developers › Access tokens). Test tokens start with
        duffel_test_.
      </Text>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  row: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  between: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  shrink: { flexShrink: 1, minWidth: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  name: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  muted: { color: colors.muted },
  small: { fontSize: font.small, color: colors.muted },
  failed: { color: colors.dangerText },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  start: { alignItems: 'flex-start' },
});
