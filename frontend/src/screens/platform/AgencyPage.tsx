import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ComponentProps, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { api } from '../../api/client';
import { applyServerErrors, errorMessage } from '../../api/errors';
import { AgencyAdmin, Tenant, TenantDetail, TenantDomain } from '../../api/types';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useConfirm } from '../../components/ConfirmDialog';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/Field';
import { FormFooter } from '../../components/FormSection';
import { StatusChip, Tone } from '../../components/StatusChip';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { TextField } from '../../components/TextField';
import { PLATFORM_HOST } from '../../config';
import { colors, font, radius, space, useIsWide, weight } from '../../theme';
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

/** An agency's own page: everything about it, with a way back to the list. */
export function AgencyPage({ id, onBack }: { id: string; onBack: () => void }) {
  const tenant = useQuery({
    queryKey: detailKey(id),
    queryFn: async () => (await api.get<TenantDetail>(`/platform/tenants/${id}`)).data,
  });
  return (
    <Screen>
      <BackLink label="All agencies" onPress={onBack} />
      {tenant.isPending ? (
        <LoadingState />
      ) : tenant.isError ? (
        <ErrorState error={tenant.error} onRetry={() => tenant.refetch()} />
      ) : (
        <Agency tenant={tenant.data} />
      )}
    </Screen>
  );
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
  const isWide = useIsWide();
  const main = (
    <>
      <Card>
        <Text style={styles.section}>Agency</Text>
        <NameForm tenant={tenant} />
        <Detail label="Address" value={tenant.primary_domain ?? '—'} />
        <Detail label="Created" value={createdOn(tenant)} />
      </Card>
      <Admins tenant={tenant} />
      <Domains tenant={tenant} />
    </>
  );
  const side = (
    <>
      <AgencyBilling tenant={tenant} onSaved={refresh} />
      <SearchAllowance tenant={tenant} />
    </>
  );
  return (
    <>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{tenant.name}</Text>
            <StatusChip label={status.label} tone={status.tone} />
          </View>
          <Text style={styles.muted}>{tenant.primary_domain ?? tenant.slug}</Text>
        </View>
        <Button
          title={tenant.is_active ? 'Suspend agency' : 'Reactivate agency'}
          variant={tenant.is_active ? 'danger' : 'primary'}
          onPress={toggle}
          loading={setActive.isPending}
        />
      </View>
      <FormError message={setActive.isError ? errorMessage(setActive.error) : null} />
      {!tenant.is_active ? (
        <Card>
          <Text style={styles.text}>
            {tenant.suspension_reason === 'non_payment'
              ? 'Suspended automatically: an invoice is more than a month overdue. Marking it paid reactivates the agency; reactivating it now waives that invoice for suspension.'
              : 'Suspended: its app answers that the agency is not available. Data is kept.'}
            {tenant.suspended_at ? ` Since ${formatDateTime(tenant.suspended_at)}.` : ''}
          </Text>
        </Card>
      ) : null}

      {isWide ? (
        <View style={styles.columns}>
          <View style={styles.column}>{main}</View>
          <View style={styles.column}>{side}</View>
        </View>
      ) : (
        <>
          {main}
          {side}
        </>
      )}
    </>
  );
}

const adminsKey = (id: string) => [...AGENCIES_KEY, 'admins', id];

/** The agency's admins: suspend or restore each one, or email them a password reset link. */
function Admins({ tenant }: { tenant: TenantDetail }) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const key = adminsKey(tenant.id);
  const base = `/platform/tenants/${tenant.id}/admins`;
  const admins = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<AgencyAdmin[]>(base)).data,
  });
  const setActive = useMutation({
    mutationFn: async ({ admin, is_active }: { admin: AgencyAdmin; is_active: boolean }) =>
      (await api.patch<AgencyAdmin>(`${base}/${admin.id}`, { is_active })).data,
    onSuccess: (data) =>
      queryClient.setQueryData<AgencyAdmin[]>(key, (list) => list?.map((item) => (item.id === data.id ? data : item))),
  });
  const sendReset = useMutation({
    mutationFn: async (admin: AgencyAdmin) =>
      (await api.post<{ detail: string }>(`${base}/${admin.id}/password-reset`)).data,
  });

  const onToggle = async (admin: AgencyAdmin) => {
    const suspending = admin.is_active;
    if (
      await confirm(
        suspending
          ? {
              title: 'Suspend this admin?',
              message: `${admin.full_name} (${admin.email}) can no longer sign in to ${tenant.name}, and is signed out everywhere. Nothing is deleted.`,
              confirmLabel: 'Suspend',
              tone: 'danger',
            }
          : {
              title: 'Restore this admin?',
              message: `${admin.full_name} (${admin.email}) can sign in to ${tenant.name} again.`,
              confirmLabel: 'Restore',
              tone: 'primary',
            },
      )
    ) {
      sendReset.reset();
      setActive.mutate({ admin, is_active: !suspending });
    }
  };

  const onReset = async (admin: AgencyAdmin) => {
    if (
      await confirm({
        title: 'Send a password reset link?',
        message: `${admin.email} gets an email with a link to choose a new password. Their current password keeps working until then.`,
        confirmLabel: 'Send link',
        tone: 'primary',
      })
    ) {
      setActive.reset();
      sendReset.mutate(admin);
    }
  };

  const busy = setActive.isPending || sendReset.isPending;
  const actionError = setActive.error ?? sendReset.error;
  return (
    <Card>
      <Text style={styles.section}>Admins</Text>
      <Text style={styles.muted}>
        The agency's admin accounts. A suspended admin cannot sign in; reset links are sent only while the agency and
        the admin are active.
      </Text>
      {admins.isPending ? (
        <LoadingState />
      ) : admins.isError ? (
        <ErrorState error={admins.error} onRetry={() => admins.refetch()} />
      ) : admins.data.length === 0 ? (
        <Text style={styles.muted}>This agency has no admins.</Text>
      ) : (
        <View style={styles.domains}>
          {admins.data.map((admin) => (
            <View key={admin.id} style={styles.admin}>
              <View style={styles.adminText}>
                <View style={styles.titleRow}>
                  <Text style={styles.adminName} numberOfLines={1}>
                    {admin.full_name || admin.email}
                  </Text>
                  {admin.is_active ? null : <StatusChip label="Suspended" tone="danger" />}
                </View>
                <Text style={styles.text} numberOfLines={1}>
                  {admin.email}
                </Text>
                <Text style={styles.small}>
                  {admin.last_login ? `Last signed in ${formatDateTime(admin.last_login)}` : 'Never signed in'}
                </Text>
              </View>
              <View style={styles.actions}>
                <Button
                  title="Send reset link"
                  variant="link"
                  onPress={() => onReset(admin)}
                  disabled={busy || !admin.is_active || !tenant.is_active}
                />
                <Button
                  title={admin.is_active ? 'Suspend' : 'Restore'}
                  variant="link"
                  onPress={() => onToggle(admin)}
                  disabled={busy}
                />
              </View>
            </View>
          ))}
        </View>
      )}
      <FormError message={actionError ? errorMessage(actionError) : null} />
      {sendReset.isSuccess ? <Text style={styles.saved}>{sendReset.data.detail}</Text> : null}
    </Card>
  );
}

const allowanceSchema = z.object({
  monthly_search_allowance: z
    .string()
    .trim()
    .regex(/^\d{1,9}$/, 'Enter a whole number of searches.'),
});

/** Fare searches per calendar month: what the agency used this month, and the allowance (editable). */
function SearchAllowance({ tenant }: { tenant: TenantDetail }) {
  const refresh = useRefresh(tenant);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { control, handleSubmit, setError, reset, formState } = useForm<{ monthly_search_allowance: string }>({
    resolver: zodResolver(allowanceSchema),
    defaultValues: { monthly_search_allowance: String(tenant.monthly_search_allowance) },
  });

  const onSave = handleSubmit(async ({ monthly_search_allowance }) => {
    setFormError(null);
    setSaved(false);
    try {
      const { data } = await api.patch<TenantDetail>(`/platform/tenants/${tenant.id}`, {
        monthly_search_allowance: Number(monthly_search_allowance),
      });
      reset({ monthly_search_allowance: String(data.monthly_search_allowance) });
      setSaved(true);
      await refresh(data);
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['monthly_search_allowance']));
    }
  });

  return (
    <Card>
      <Text style={styles.section}>Fare searches</Text>
      <Text style={styles.muted}>
        Searches its routes make through its integrations, per calendar month (Nairobi time).
      </Text>
      <Detail
        label="Used this month"
        value={`${tenant.searches_this_month.toLocaleString('en-US')} of ${tenant.monthly_search_allowance.toLocaleString('en-US')}`}
      />
      <Controller
        control={control}
        name="monthly_search_allowance"
        render={({ field, fieldState }) => (
          <TextField
            label="Monthly allowance"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            keyboardType="number-pad"
            onSubmitEditing={() => onSave()}
          />
        )}
      />
      <FormError message={formError} />
      {saved && !formState.isDirty ? <Text style={styles.saved}>Allowance saved.</Text> : null}
      <FormFooter>
        <Button
          title="Save allowance"
          onPress={onSave}
          loading={formState.isSubmitting}
          disabled={!formState.isDirty}
        />
      </FormFooter>
    </Card>
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
        Hostnames that open this agency. The primary one is used in its email links. Extra hostnames also need to be
        allowed in the server settings (ALLOWED_HOSTS and CORS).
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
  slug: z.string().trim().regex(SLUG, 'Use 3 to 30 lowercase letters, digits and hyphens, starting with a letter.'),
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
        Creating an agency sets up its own data, its address and its first admin, who can sign in there straight away.
        This takes a few seconds.
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.md,
  },
  headerText: { gap: 2, flexShrink: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: space.lg },
  column: { flex: 1, minWidth: 0, gap: space.lg },
  admin: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.sm,
    padding: space.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  adminText: { gap: 2, flexShrink: 1, minWidth: 0 },
  adminName: { fontSize: font.body, fontWeight: weight.bold, color: colors.text, flexShrink: 1 },
  small: { fontSize: font.small, color: colors.muted },
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
