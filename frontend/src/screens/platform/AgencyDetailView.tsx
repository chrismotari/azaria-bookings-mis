import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ComponentProps, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { api } from '../../api/client';
import { applyServerErrors, errorMessage } from '../../api/errors';
import { Tenant, TenantDetail, TenantDomain } from '../../api/types';
import { ActionBar } from '../../components/ActionBar';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useConfirm } from '../../components/ConfirmDialog';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/Field';
import { FormFooter } from '../../components/FormSection';
import { StatusChip, Tone } from '../../components/StatusChip';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { TextField } from '../../components/TextField';
import { PLATFORM_HOST } from '../../config';
import { colors, font, radius, space, weight } from '../../theme';
import { formatDate, formatDateTime } from '../../utils/format';
import { AgencyBilling } from './AgencyBilling';
import { AGENCIES_KEY } from './keys';

/** Keyed by String(is_active). */
const TENANT_STATUS: Record<string, { label: string; tone: Tone }> = {
  true: { label: 'Active', tone: 'success' },
  false: { label: 'Suspended', tone: 'danger' },
};

export { AGENCIES_KEY };

/** Active, Suspended, or Suspended for non-payment. */
export function tenantStatus(tenant: Tenant): { label: string; tone: Tone } {
  if (!tenant.is_active && tenant.suspension_reason === 'non_payment') {
    return { label: 'Suspended for non-payment', tone: 'danger' };
  }
  return TENANT_STATUS[String(tenant.is_active)];
}

const detailKey = (id: string) => [...AGENCIES_KEY, 'detail', id];

/** The date part of a timestamp, for formatDate. */
export const createdOn = (tenant: Tenant) => formatDate(tenant.created_at.slice(0, 10));

export function AgencyDetailView({ id }: { id: string }) {
  const tenant = useQuery({
    queryKey: detailKey(id),
    queryFn: async () => (await api.get<TenantDetail>(`/platform/tenants/${id}`)).data,
  });
  if (tenant.isPending) {
    return <LoadingState />;
  }
  if (tenant.isError) {
    return <ErrorState error={tenant.error} onRetry={() => tenant.refetch()} />;
  }
  return <Agency tenant={tenant.data} />;
}

/** Refreshes the open agency and the list after a change. */
function useRefresh(tenant: TenantDetail) {
  const queryClient = useQueryClient();
  return (data?: TenantDetail) => {
    if (data) {
      queryClient.setQueryData(detailKey(tenant.id), data);
    }
    return queryClient.invalidateQueries({ queryKey: AGENCIES_KEY });
  };
}

function Agency({ tenant }: { tenant: TenantDetail }) {
  const confirm = useConfirm();
  const refresh = useRefresh(tenant);
  const setActive = useMutation({
    mutationFn: async (is_active: boolean) =>
      (await api.patch<TenantDetail>(`/platform/tenants/${tenant.id}`, { is_active })).data,
    onSuccess: refresh,
  });

  const toggle = async () => {
    const suspending = tenant.is_active;
    if (
      await confirm(
        suspending
          ? {
              title: 'Suspend this agency?',
              message: `Nobody can use ${tenant.name} (its admins and customers) until you reactivate it. Its scheduled jobs and emails stop. Nothing is deleted.`,
              confirmLabel: 'Suspend',
              tone: 'danger',
            }
          : {
              title: 'Reactivate this agency?',
              message: `${tenant.name} becomes available again to its admins and customers.`,
              confirmLabel: 'Reactivate',
              tone: 'primary',
            },
      )
    ) {
      setActive.mutate(!suspending);
    }
  };

  const status = tenantStatus(tenant);
  return (
    <>
      <ActionBar>
        <Button
          title={tenant.is_active ? 'Suspend' : 'Reactivate'}
          variant={tenant.is_active ? 'danger' : 'primary'}
          onPress={toggle}
          loading={setActive.isPending}
        />
      </ActionBar>
      <FormError message={setActive.isError ? errorMessage(setActive.error) : null} />

      <Card>
        <View style={styles.between}>
          <Text style={styles.section}>Agency</Text>
          <StatusChip label={status.label} tone={status.tone} />
        </View>
        {!tenant.is_active ? (
          <Text style={styles.muted}>
            {tenant.suspension_reason === 'non_payment'
              ? 'Suspended automatically: an invoice is more than a month overdue. Marking it paid reactivates the agency; reactivating it now waives that invoice for suspension.'
              : 'Suspended: its app answers that the agency is not available. Data is kept.'}
            {tenant.suspended_at ? ` Since ${formatDateTime(tenant.suspended_at)}.` : ''}
          </Text>
        ) : null}
        <NameForm tenant={tenant} />
        <Detail label="Address" value={tenant.primary_domain ?? '—'} />
        <Detail label="Created" value={createdOn(tenant)} />
      </Card>

      <AgencyBilling tenant={tenant} onSaved={refresh} />

      <Domains tenant={tenant} />
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.text}>{value}</Text>
    </View>
  );
}

const nameSchema = z.object({ name: z.string().trim().min(1, "Enter the agency's name.").max(100) });

function NameForm({ tenant }: { tenant: TenantDetail }) {
  const refresh = useRefresh(tenant);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { control, handleSubmit, setError, reset, formState } = useForm<{ name: string }>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: tenant.name },
  });

  const onSave = handleSubmit(async ({ name }) => {
    setFormError(null);
    setSaved(false);
    try {
      const { data } = await api.patch<TenantDetail>(`/platform/tenants/${tenant.id}`, { name });
      reset({ name: data.name });
      setSaved(true);
      await refresh(data);
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['name']));
    }
  });

  return (
    <>
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
            autoCapitalize="words"
            onSubmitEditing={() => onSave()}
          />
        )}
      />
      <FormError message={formError} />
      {saved && !formState.isDirty ? <Text style={styles.saved}>Name saved.</Text> : null}
      <FormFooter>
        <Button title="Save name" onPress={onSave} loading={formState.isSubmitting} disabled={!formState.isDirty} />
      </FormFooter>
    </>
  );
}

function Domains({ tenant }: { tenant: TenantDetail }) {
  const confirm = useConfirm();
  const refresh = useRefresh(tenant);
  const [domain, setDomain] = useState('');
  const base = `/platform/tenants/${tenant.id}/domains`;

  const add = useMutation({
    mutationFn: async () => (await api.post<TenantDomain>(base, { domain })).data,
    onSuccess: () => {
      setDomain('');
      return refresh();
    },
  });
  const remove = useMutation({
    mutationFn: async (item: TenantDomain) => api.delete(`${base}/${item.id}`),
    onSuccess: () => refresh(),
  });
  const makePrimary = useMutation({
    mutationFn: async (item: TenantDomain) => (await api.post<TenantDomain>(`${base}/${item.id}/make-primary`)).data,
    onSuccess: () => refresh(),
  });

  const onRemove = async (item: TenantDomain) => {
    if (
      await confirm({
        title: 'Remove this domain?',
        message: `${tenant.name} will no longer answer at ${item.domain}.`,
        confirmLabel: 'Remove',
        tone: 'danger',
      })
    ) {
      remove.mutate(item);
    }
  };

  const onMakePrimary = async (item: TenantDomain) => {
    if (
      await confirm({
        title: 'Make this the primary domain?',
        message: `Links in ${tenant.name}'s emails (password resets, bookings) will point at ${item.domain}.`,
        confirmLabel: 'Make primary',
        tone: 'primary',
      })
    ) {
      makePrimary.mutate(item);
    }
  };

  const busy = remove.isPending || makePrimary.isPending;
  const actionError = remove.error ?? makePrimary.error;
  return (
    <Card>
      <Text style={styles.section}>Domains</Text>
      <Text style={styles.muted}>
        Hostnames that open this agency. The primary one is used in its email links. Extra hostnames also need to
        be allowed in the server settings (ALLOWED_HOSTS and CORS).
      </Text>
      <View style={styles.domains}>
        {tenant.domains.map((item) => (
          <View key={item.id} style={styles.domain}>
            <Text style={[styles.text, styles.shrink]} numberOfLines={1}>
              {item.domain}
            </Text>
            {item.is_primary ? (
              <StatusChip label="Primary" tone="info" />
            ) : (
              <View style={styles.actions}>
                <Button title="Make primary" variant="link" onPress={() => onMakePrimary(item)} disabled={busy} />
                <Button title="Remove" variant="link" onPress={() => onRemove(item)} disabled={busy} />
              </View>
            )}
          </View>
        ))}
      </View>
      <FormError message={actionError ? errorMessage(actionError) : null} />
      <TextField
        label="Add a domain"
        value={domain}
        onChangeText={(value) => {
          setDomain(value);
          add.reset();
        }}
        placeholder={`e.g. ${tenant.slug}.192.168.1.37.nip.io`}
        autoCapitalize="none"
        autoCorrect={false}
        error={add.isError ? errorMessage(add.error) : undefined}
        onSubmitEditing={() => domain.trim() && add.mutate()}
      />
      <FormFooter>
        <Button
          title="Add domain"
          variant="secondary"
          onPress={() => add.mutate()}
          loading={add.isPending}
          disabled={!domain.trim()}
        />
      </FormFooter>
    </Card>
  );
}

// New agency

const SLUG = /^[a-z][a-z0-9-]{2,29}$/;

// Mirrors the server's rules; the server also checks reserved and taken addresses and the password's strength.
const newSchema = z.object({
  name: z.string().trim().min(1, "Enter the agency's name.").max(100),
  slug: z
    .string()
    .trim()
    .regex(SLUG, 'Use 3 to 30 lowercase letters, digits and hyphens, starting with a letter.'),
  admin_name: z.string().trim().min(1, "Enter the admin's name.").max(150),
  admin_email: z.email('Enter a valid email address.'),
  admin_password: z.string().min(1, 'Enter a password for the admin.'),
});

type NewValues = z.infer<typeof newSchema>;

const NEW_FIELDS = ['name', 'slug', 'admin_name', 'admin_email', 'admin_password'] as const;

type NewAgencyProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (tenant: TenantDetail) => void;
};

/** Creates an agency with its address and first admin. */
export function NewAgencyDialog({ open, onClose, onCreated }: NewAgencyProps) {
  // A fresh form each time the dialog opens.
  return open ? <NewAgencyForm onClose={onClose} onCreated={onCreated} /> : null;
}

function NewAgencyForm({ onClose, onCreated }: Omit<NewAgencyProps, 'open'>) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, watch, formState } = useForm<NewValues>({
    resolver: zodResolver(newSchema),
    defaultValues: { name: '', slug: '', admin_name: '', admin_email: '', admin_password: '' },
  });
  const slug = watch('slug').trim();

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const { data } = await api.post<TenantDetail>('/platform/tenants', values);
      await queryClient.invalidateQueries({ queryKey: AGENCIES_KEY });
      onCreated(data);
    } catch (error) {
      setFormError(applyServerErrors(error, setError, NEW_FIELDS));
    }
  });

  const field = (
    name: (typeof NEW_FIELDS)[number],
    label: string,
    options: Partial<ComponentProps<typeof TextField>> = {},
  ) => (
    <Controller
      control={control}
      name={name}
      render={({ field: input, fieldState }) => (
        <TextField
          label={label}
          value={input.value}
          onChangeText={input.onChange}
          onBlur={input.onBlur}
          error={fieldState.error?.message}
          autoCorrect={false}
          {...options}
        />
      )}
    />
  );

  return (
    <Dialog
      open
      title="New agency"
      size="large"
      onClose={onClose}
      busy={formState.isSubmitting}
      error={formError}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={formState.isSubmitting} />
          <Button title="Create agency" onPress={onSubmit} loading={formState.isSubmitting} />
        </>
      }
    >
      <Text style={styles.text}>
        Creating an agency sets up its own data, its address and its first admin, who can sign in there straight
        away. This takes a few seconds.
      </Text>
      {field('name', 'Agency name', { autoCapitalize: 'words' })}
      {field('slug', 'Address', { autoCapitalize: 'none', placeholder: 'e.g. acme-travel' })}
      <View style={styles.hint}>
        <Text style={styles.hintText}>
          Reached at <Text style={styles.hintStrong}>{`${slug || 'address'}.${PLATFORM_HOST}`}</Text>. The address
          cannot be changed later.
        </Text>
      </View>
      <Text style={styles.subsection}>First admin</Text>
      {field('admin_name', 'Full name', { autoCapitalize: 'words' })}
      {field('admin_email', 'Email', { autoCapitalize: 'none', keyboardType: 'email-address' })}
      {field('admin_password', 'Password', { secureTextEntry: true, autoComplete: 'new-password' })}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  section: { fontSize: font.heading, fontWeight: weight.bold, color: colors.tertiary },
  subsection: { fontSize: font.body, fontWeight: weight.bold, color: colors.text, marginTop: space.xs },
  text: { color: colors.text, fontSize: font.body },
  muted: { color: colors.muted },
  saved: { color: colors.successText, fontWeight: weight.semibold },
  detail: { gap: 2 },
  detailLabel: { fontSize: font.small, color: colors.muted },
  domains: { gap: space.xs },
  domain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  shrink: { flexShrink: 1 },
  actions: { flexDirection: 'row', gap: space.sm },
  hint: { marginTop: -space.xs },
  hintText: { fontSize: font.small, color: colors.muted },
  hintStrong: { fontWeight: weight.semibold, color: colors.text },
});
