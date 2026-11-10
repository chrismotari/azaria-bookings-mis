import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { BillingCycle, Invoice, Paginated, Plan, PlanKind, Subscription, TenantDetail } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useConfirm } from '../../components/ConfirmDialog';
import { DateField } from '../../components/DateField';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/Field';
import { FormFooter } from '../../components/FormSection';
import { SegmentedControl } from '../../components/SegmentedControl';
import { SelectField } from '../../components/SelectField';
import { EmptyState } from '../../components/StatusViews';
import { TextField } from '../../components/TextField';
import { colors, font, radius, space, weight } from '../../theme';
import { formatDate, formatMoney, todayInNairobi } from '../../utils/format';
import { InvoiceCard } from './InvoicesScreen';
import { INVOICES_KEY, PLANS_KEY } from './keys';

const KIND_LABEL: Record<PlanKind, string> = {
  subscription: 'Subscription plan',
  support: 'Support plan',
};

const CYCLES: { value: BillingCycle; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
];

const subscriptionsKey = (id: string) => ['platform', 'tenants', 'subscriptions', id];

/** The agency drawer's "Plan & billing" section: billing email, its two plans and its invoices. */
export function AgencyBilling({ tenant, onSaved }: { tenant: TenantDetail; onSaved: (data: TenantDetail) => void }) {
  const subscriptions = useQuery({
    queryKey: subscriptionsKey(tenant.id),
    queryFn: async () => (await api.get<Subscription[]>(`/platform/tenants/${tenant.id}/subscriptions`)).data,
  });
  const running = (kind: PlanKind) => subscriptions.data?.find((item) => item.kind === kind && !item.ended_on);

  return (
    <Card>
      <Text style={styles.section}>Plan & billing</Text>
      <BillingEmail tenant={tenant} onSaved={onSaved} />
      {subscriptions.isError ? <FormError message={errorMessage(subscriptions.error)} /> : null}
      {subscriptions.isSuccess
        ? (['subscription', 'support'] as const).map((kind) => (
            <PlanRow key={kind} tenant={tenant} kind={kind} subscription={running(kind)} />
          ))
        : null}
      <AgencyInvoices tenant={tenant} />
    </Card>
  );
}

function BillingEmail({ tenant, onSaved }: { tenant: TenantDetail; onSaved: (data: TenantDetail) => void }) {
  const [email, setEmail] = useState(tenant.billing_email);
  const save = useMutation({
    mutationFn: async () =>
      (
        await api.patch<TenantDetail>(`/platform/tenants/${tenant.id}`, {
          billing_email: email.trim(),
        })
      ).data,
    onSuccess: onSaved,
  });
  const dirty = email.trim() !== tenant.billing_email;
  return (
    <>
      <TextField
        label="Billing email"
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          save.reset();
        }}
        placeholder="Where invoices are sent"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        error={save.isError ? errorMessage(save.error) : undefined}
      />
      {save.isSuccess && !dirty ? <Text style={styles.saved}>Billing email saved.</Text> : null}
      {!tenant.billing_email ? (
        <Text style={styles.muted}>Add a billing email before starting a plan: invoices are sent there.</Text>
      ) : null}
      <FormFooter>
        <Button
          title="Save billing email"
          variant="secondary"
          onPress={() => save.mutate()}
          loading={save.isPending}
          disabled={!dirty}
        />
      </FormFooter>
    </>
  );
}

/** Refreshes everything a subscription change touches. */
function useRefreshBilling(tenant: TenantDetail) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: subscriptionsKey(tenant.id) }),
      queryClient.invalidateQueries({ queryKey: INVOICES_KEY }),
    ]);
}

function PlanRow({
  tenant,
  kind,
  subscription,
}: {
  tenant: TenantDetail;
  kind: PlanKind;
  subscription?: Subscription;
}) {
  const confirm = useConfirm();
  const refresh = useRefreshBilling(tenant);
  const [dialog, setDialog] = useState<'start' | 'change' | null>(null);
  const act = useMutation({
    mutationFn: async (action: 'end' | 'issue-invoice') =>
      api.post(`/platform/subscriptions/${subscription?.id}/${action}`),
    onSuccess: refresh,
  });

  const onEnd = async () => {
    if (
      subscription &&
      (await confirm({
        title: `End the ${subscription.plan.name} plan?`,
        message: `${tenant.name} is not invoiced for it again. Invoices already issued stay as they are.`,
        confirmLabel: 'End plan',
        tone: 'danger',
      }))
    ) {
      act.mutate('end');
    }
  };
  const onIssue = async () => {
    if (
      subscription &&
      (await confirm({
        title: 'Issue the next invoice now?',
        message: `The invoice for the period starting ${formatDate(subscription.next_period_start)} is issued and emailed today, ahead of the daily run.`,
        confirmLabel: 'Issue invoice',
        tone: 'primary',
      }))
    ) {
      act.mutate('issue-invoice');
    }
  };

  return (
    <View style={styles.plan}>
      <Text style={styles.planKind}>{KIND_LABEL[kind]}</Text>
      {subscription ? (
        <>
          <Text style={styles.planName}>
            {subscription.plan.name} · {subscription.billing_cycle === 'monthly' ? 'Monthly' : 'Annual'}
            {subscription.price ? ` · ${formatMoney(subscription.price, subscription.currency)}` : ''}
          </Text>
          <Text style={styles.muted}>
            Since {formatDate(subscription.started_on)} · next period starts{' '}
            {formatDate(subscription.next_period_start)}
          </Text>
          <View style={styles.actions}>
            <Button title="Change" variant="link" onPress={() => setDialog('change')} disabled={act.isPending} />
            <Button title="Issue next invoice" variant="link" onPress={onIssue} disabled={act.isPending} />
            <Button title="End" variant="link" onPress={onEnd} disabled={act.isPending} />
          </View>
        </>
      ) : (
        <View style={styles.between}>
          <Text style={styles.muted}>None</Text>
          <Button title="Start" variant="secondary" onPress={() => setDialog('start')} />
        </View>
      )}
      <FormError message={act.isError ? errorMessage(act.error) : null} />
      {dialog ? (
        <SubscriptionDialog
          tenant={tenant}
          kind={kind}
          subscription={dialog === 'change' ? subscription : undefined}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null);
            await refresh();
          }}
        />
      ) : null}
    </View>
  );
}

/** Starts a plan of one kind (first invoice issued at once) or changes the running one (from the next invoice). */
function SubscriptionDialog({
  tenant,
  kind,
  subscription,
  onClose,
  onDone,
}: {
  tenant: TenantDetail;
  kind: PlanKind;
  subscription?: Subscription;
  onClose: () => void;
  onDone: () => void;
}) {
  const plans = useQuery({
    queryKey: [...PLANS_KEY, kind, 'active'],
    queryFn: async () =>
      (
        await api.get<Paginated<Plan>>('/platform/plans', {
          params: { kind, is_active: 'true' },
        })
      ).data.results,
  });
  const [planId, setPlanId] = useState(subscription?.plan.id ?? '');
  const [cycle, setCycle] = useState<BillingCycle>(subscription?.billing_cycle ?? 'monthly');
  const [startedOn, setStartedOn] = useState(todayInNairobi());
  const save = useMutation({
    mutationFn: async () =>
      subscription
        ? api.patch(`/platform/subscriptions/${subscription.id}`, {
            plan: planId,
            billing_cycle: cycle,
          })
        : api.post(`/platform/tenants/${tenant.id}/subscriptions`, {
            plan: planId,
            billing_cycle: cycle,
            started_on: startedOn,
          }),
    onSuccess: onDone,
  });

  const options = [
    // The running plan stays choosable even if it is no longer offered.
    ...(subscription && !plans.data?.some((plan) => plan.id === subscription.plan.id)
      ? [
          {
            value: subscription.plan.id,
            label: `${subscription.plan.name} (no longer offered)`,
          },
        ]
      : []),
    ...(plans.data ?? []).map((plan) => ({ value: plan.id, label: plan.name })),
  ];
  const chosen = plans.data?.find((plan) => plan.id === planId);
  const price = chosen ? (cycle === 'monthly' ? chosen.monthly_price : chosen.annual_price) : null;
  const title = subscription ? `Change ${KIND_LABEL[kind].toLowerCase()}` : `Start ${KIND_LABEL[kind].toLowerCase()}`;

  return (
    <Dialog
      open
      title={title}
      size="large"
      onClose={onClose}
      busy={save.isPending}
      error={save.isError ? errorMessage(save.error) : null}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={save.isPending} />
          <Button
            title={subscription ? 'Save change' : 'Start and issue invoice'}
            onPress={() => save.mutate()}
            loading={save.isPending}
            disabled={!planId || (!!chosen && price === null)}
          />
        </>
      }
    >
      {plans.isSuccess && options.length === 0 ? (
        <EmptyState
          icon="layers-outline"
          title={`No ${kind} plans offered`}
          message="Create one on the Plans screen first."
        />
      ) : (
        <>
          <SelectField
            label="Plan"
            options={[
              {
                value: '',
                label: plans.isPending ? 'Loading plans…' : 'Choose a plan',
              },
              ...options,
            ]}
            value={planId}
            onChange={setPlanId}
          />
          <SegmentedControl label="Billing cycle" options={CYCLES} value={cycle} onChange={setCycle} />
          {chosen ? (
            <Text style={price === null ? styles.warning : styles.text}>
              {price === null
                ? `${chosen.name} has no ${cycle} price.`
                : `${formatMoney(price, chosen.currency)} ${cycle === 'monthly' ? 'a month' : 'a year'}.`}
            </Text>
          ) : null}
          {subscription ? (
            <Text style={styles.muted}>
              Applies from the next invoice (period starting {formatDate(subscription.next_period_start)}). Invoices
              already issued are unchanged.
            </Text>
          ) : (
            <>
              <DateField label="Starts on" value={startedOn} onChange={setStartedOn} />
              <Text style={styles.muted}>
                The first invoice, for the period starting on this day, is issued and emailed to{' '}
                {tenant.billing_email || 'the billing email'} straight away.
              </Text>
            </>
          )}
        </>
      )}
    </Dialog>
  );
}

function AgencyInvoices({ tenant }: { tenant: TenantDetail }) {
  const navigation = useNavigation();
  const invoices = useQuery({
    queryKey: [...INVOICES_KEY, 'tenant', tenant.id],
    queryFn: async () =>
      (
        await api.get<Paginated<Invoice>>('/platform/invoices', {
          params: { tenant: tenant.id },
        })
      ).data,
  });
  return (
    <View style={styles.invoices}>
      <Text style={styles.planKind}>Invoices</Text>
      {invoices.isError ? <FormError message={errorMessage(invoices.error)} /> : null}
      {invoices.data?.results.length === 0 ? <Text style={styles.muted}>None yet.</Text> : null}
      {invoices.data?.results.map((invoice) => (
        <InvoiceCard
          key={invoice.id}
          invoice={invoice}
          onPress={() =>
            navigation.navigate('PlatformTabs', {
              screen: 'PlatformInvoices',
              params: { id: invoice.id },
            })
          }
        />
      ))}
      {invoices.data && invoices.data.count > invoices.data.results.length ? (
        <Text style={styles.muted}>
          Showing the latest {invoices.data.results.length} of {invoices.data.count}; the rest are on the Invoices
          screen.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    fontSize: font.heading,
    fontWeight: weight.bold,
    color: colors.tertiary,
  },
  plan: {
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  planKind: {
    fontSize: font.small,
    fontWeight: weight.bold,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  planName: {
    fontSize: font.body,
    fontWeight: weight.bold,
    color: colors.text,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
  },
  invoices: { gap: space.sm },
  text: { color: colors.text },
  muted: { color: colors.muted },
  warning: { color: colors.warningText, fontWeight: weight.semibold },
  saved: { color: colors.successText, fontWeight: weight.semibold },
});
