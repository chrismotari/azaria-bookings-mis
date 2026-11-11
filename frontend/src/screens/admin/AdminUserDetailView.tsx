import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Control, Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { api } from '../../api/client';
import { applyServerErrors, errorMessage } from '../../api/errors';
import { AdminCustomer } from '../../api/types';
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
import { useAuth } from '../../auth/AuthContext';
import { colors, font, space, weight } from '../../theme';

/** Keyed by String(is_active). */
export const USER_STATUS: Record<string, { label: string; tone: Tone }> = {
  true: { label: 'Active', tone: 'success' },
  false: { label: 'Deactivated', tone: 'neutral' },
};

type Values = { full_name: string; email: string; phone: string };

const FIELDS = ['full_name', 'email', 'phone'] as const;

const schema = z.object({
  full_name: z.string().trim().min(1, "Enter the customer's name.").max(150),
  email: z.string().trim().email('Enter a valid email address.'),
  phone: z.string().trim().max(30),
});

const detailKey = (id: string) => ['admin', 'users', 'detail', id];

/** Name, email and phone fields, shared by the drawer and the New user dialog. */
function UserFields({ control }: { control: Control<Values> }) {
  return (
    <>
      {(
        [
          ['full_name', 'Full name', 'default'],
          ['email', 'Email', 'email-address'],
          ['phone', 'Phone (optional)', 'phone-pad'],
        ] as const
      ).map(([name, label, keyboardType]) => (
        <Controller
          key={name}
          control={control}
          name={name}
          render={({ field, fieldState }) => (
            <TextField
              label={label}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              keyboardType={keyboardType}
              autoCapitalize={name === 'full_name' ? 'words' : 'none'}
              autoCorrect={false}
            />
          )}
        />
      ))}
    </>
  );
}

/** A customer or admin in the drawer: editable details; Make admin (customers), Send reset link, and Deactivate or
 * Reactivate (not on your own account) in the action bar. */
export function AdminUserDetailView({ id, onPromoted }: { id: string; onPromoted: (message: string) => void }) {
  const user = useQuery({
    queryKey: detailKey(id),
    queryFn: async () => (await api.get<AdminCustomer>(`/admin/users/${id}`)).data,
  });
  if (user.isPending) {
    return <LoadingState />;
  }
  if (user.isError) {
    return <ErrorState error={user.error} onRetry={() => user.refetch()} />;
  }
  return <UserForm user={user.data} onPromoted={onPromoted} />;
}

function UserForm({ user, onPromoted }: { user: AdminCustomer; onPromoted: (message: string) => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { user: me } = useAuth();
  const isAdmin = user.role === 'admin';
  const isMe = me?.id === user.id;
  const kind = isAdmin ? 'admin' : 'customer';
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { control, handleSubmit, setError, reset, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: user.full_name, email: user.email, phone: user.phone },
  });

  const updated = (data: AdminCustomer) => {
    queryClient.setQueryData(detailKey(user.id), data);
    return queryClient.invalidateQueries({ queryKey: ['admin', 'users'], exact: false });
  };

  const setActive = useMutation({
    mutationFn: async (is_active: boolean) =>
      (await api.patch<AdminCustomer>(`/admin/users/${user.id}`, { is_active })).data,
    onSuccess: updated,
  });

  const sendReset = useMutation({
    mutationFn: async () => (await api.post<{ detail: string }>(`/admin/users/${user.id}/password-reset`)).data,
  });

  const onReset = async () => {
    if (
      await confirm({
        title: 'Send a password reset link?',
        message: `${user.email} gets an email with a link to choose a new password. Their current password keeps working until then.`,
        confirmLabel: 'Send link',
        tone: 'primary',
      })
    ) {
      sendReset.mutate();
    }
  };

  // An admin is no longer a customer: the drawer closes and the list drops them.
  const makeAdmin = useMutation({
    mutationFn: async () => (await api.post<{ detail: string }>(`/admin/users/${user.id}/make-admin`)).data,
    onSuccess: async ({ detail }) => {
      queryClient.removeQueries({ queryKey: detailKey(user.id) });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'], exact: false });
      onPromoted(detail);
    },
  });

  const promote = async () => {
    if (
      await confirm({
        title: 'Make this customer an admin?',
        message: `${user.full_name} gets full access to the admin app: offers, requests, bookings, users, settings and billing. They keep their own requests and bookings, and move to System admins.`,
        confirmLabel: 'Make admin',
        tone: 'danger',
      })
    ) {
      makeAdmin.mutate();
    }
  };

  const onSave = handleSubmit(async (values) => {
    setFormError(null);
    setSaved(false);
    try {
      const { data } = await api.patch<AdminCustomer>(`/admin/users/${user.id}`, values);
      reset({ full_name: data.full_name, email: data.email, phone: data.phone });
      setSaved(true);
      await updated(data);
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS));
    }
  });

  const toggle = async () => {
    const deactivating = user.is_active;
    if (
      await confirm(
        deactivating
          ? {
              title: `Deactivate this ${kind}?`,
              message: `${user.full_name} will not be able to sign in, and is signed out everywhere. ${isAdmin ? 'Nothing is deleted' : 'Their requests and bookings stay'}, and you can reactivate them at any time.`,
              confirmLabel: 'Deactivate',
              tone: 'danger',
            }
          : {
              title: `Reactivate this ${kind}?`,
              message: `${user.full_name} will be able to sign in again.`,
              confirmLabel: 'Reactivate',
              tone: 'primary',
            },
      )
    ) {
      setActive.mutate(!deactivating);
    }
  };

  const status = USER_STATUS[String(user.is_active)];
  return (
    <>
      <ActionBar>
        {user.is_active ? (
          <Button
            title="Send reset link"
            variant="secondary"
            onPress={onReset}
            loading={sendReset.isPending}
          />
        ) : null}
        {user.is_active && !isAdmin ? (
          <Button
            title="Make admin"
            variant="secondary"
            onPress={promote}
            loading={makeAdmin.isPending}
            disabled={setActive.isPending}
          />
        ) : null}
        {isMe ? null : (
          <Button
            title={user.is_active ? 'Deactivate' : 'Reactivate'}
            variant={user.is_active ? 'danger' : 'primary'}
            onPress={toggle}
            loading={setActive.isPending}
          />
        )}
      </ActionBar>
      <FormError
        message={
          setActive.error || makeAdmin.error || sendReset.error
            ? errorMessage(setActive.error ?? makeAdmin.error ?? sendReset.error)
            : null
        }
      />
      {sendReset.isSuccess ? <Text style={styles.saved}>{sendReset.data.detail}</Text> : null}

      <Card>
        <View style={styles.header}>
          <Text style={styles.section}>Details</Text>
          <StatusChip label={status.label} tone={status.tone} />
        </View>
        {!user.is_active ? (
          <Text style={styles.muted}>
            {isAdmin
              ? 'Deactivated: this admin cannot sign in.'
              : 'Deactivated: this customer cannot sign in. Their requests and bookings are kept.'}
          </Text>
        ) : null}
        <UserFields control={control} />
        <FormError message={formError} />
        {saved && !formState.isDirty ? <Text style={styles.saved}>Changes saved.</Text> : null}
        <FormFooter>
          <Button
            title="Save changes"
            onPress={onSave}
            loading={formState.isSubmitting}
            disabled={!formState.isDirty}
          />
        </FormFooter>
      </Card>
    </>
  );
}

type NewUserProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (user: AdminCustomer) => void;
};

/** Adds a customer, who is emailed a link to choose their password. */
export function NewUserDialog({ open, onClose, onCreated }: NewUserProps) {
  // A fresh form each time the dialog opens.
  return open ? <NewUserForm onClose={onClose} onCreated={onCreated} /> : null;
}

function NewUserForm({ onClose, onCreated }: Omit<NewUserProps, 'open'>) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: '', email: '', phone: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const { data } = await api.post<AdminCustomer>('/admin/users', values);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      onCreated(data);
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS));
    }
  });

  return (
    <Dialog
      open
      title="New user"
      size="large"
      onClose={onClose}
      busy={formState.isSubmitting}
      error={formError}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={formState.isSubmitting} />
          <Button title="Create user" onPress={onSubmit} loading={formState.isSubmitting} />
        </>
      }
    >
      <Text style={styles.text}>
        The customer is emailed a link to choose their password. Until then they cannot sign in.
      </Text>
      <UserFields control={control} />
    </Dialog>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  section: { fontSize: font.heading, fontWeight: weight.bold, color: colors.tertiary },
  text: { color: colors.text, fontSize: font.body },
  muted: { color: colors.muted },
  saved: { color: colors.successText, fontWeight: weight.semibold },
});
