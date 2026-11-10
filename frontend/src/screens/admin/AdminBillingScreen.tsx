import { useNavigation } from '@react-navigation/native';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { AgencyBilling, AgencyInvoice, Paginated } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FormError } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { Pagination } from '../../components/Pagination';
import { Screen } from '../../components/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { colors, font, space, weight } from '../../theme';
import { formatDate, formatMoney } from '../../utils/format';
import { InvoiceCard, openInvoice } from '../platform/InvoicesScreen';

export const BILLING_KEY = ['admin', 'billing'];

/** The agency's plans and invoices with the platform, read-only (payment happens outside the app). */
export function AdminBillingScreen() {
  const navigation = useNavigation();
  const billing = useBilling();
  const [page, setPage] = useState(1);
  const invoices = useQuery({
    queryKey: [...BILLING_KEY, 'invoices', page],
    queryFn: async () =>
      (
        await api.get<Paginated<AgencyInvoice>>('/admin/billing/invoices', {
          params: { page },
        })
      ).data,
    placeholderData: keepPreviousData,
  });

  if (billing.isPending) {
    return <LoadingState />;
  }
  if (billing.isError) {
    return <ErrorState error={billing.error} onRetry={() => billing.refetch()} />;
  }
  const { subscriptions, billing_contact_email } = billing.data;
  return (
    <Screen maxWidth={760}>
      <View style={styles.back}>
        <Button
          title="← Settings"
          variant="link"
          onPress={() => navigation.navigate('AdminTabs', { screen: 'AdminSettings' })}
        />
      </View>
      <Text style={styles.title}>Billing</Text>
      <Text style={styles.muted}>
        Your agency's plans with Azaria Bookings and their invoices. Invoices are also emailed to your billing email;
        pay them as their payment instructions say.
      </Text>
      <Card>
        <Text style={styles.section}>Plans</Text>
        {subscriptions.length === 0 ? (
          <Text style={styles.muted}>No plan yet.</Text>
        ) : (
          subscriptions.map((item) => (
            <View key={item.kind} style={styles.plan}>
              <Text style={styles.planKind}>{item.kind === 'subscription' ? 'Subscription plan' : 'Support plan'}</Text>
              <Text style={styles.planName}>
                {item.plan_name} · {item.billing_cycle === 'monthly' ? 'Monthly' : 'Annual'}
                {item.price ? ` · ${formatMoney(item.price, item.currency)}` : ''}
              </Text>
              <Text style={styles.muted}>Next period starts {formatDate(item.next_period_start)}</Text>
            </View>
          ))
        )}
        {billing_contact_email ? (
          <Text style={styles.text}>Questions about billing: {billing_contact_email}</Text>
        ) : null}
        <View style={styles.open}>
          <Button
            title="Compare plans"
            variant="secondary"
            icon="layers-outline"
            onPress={() => navigation.navigate('AdminTabs', { screen: 'AdminPlans' })}
          />
        </View>
      </Card>
      <Card>
        <Text style={styles.section}>Invoices</Text>
        {invoices.isPending ? (
          <LoadingState />
        ) : invoices.isError ? (
          <ErrorState error={invoices.error} onRetry={() => invoices.refetch()} />
        ) : invoices.data.results.length === 0 ? (
          <EmptyState icon="document-text-outline" title="No invoices yet" message="They appear here once issued." />
        ) : (
          <>
            {invoices.data.results.map((invoice) => (
              <InvoiceCard key={invoice.id} invoice={invoice} action={<OpenButton invoice={invoice} />} />
            ))}
            <Pagination page={page} count={invoices.data.count} onChange={setPage} />
          </>
        )}
      </Card>
    </Screen>
  );
}

function OpenButton({ invoice }: { invoice: AgencyInvoice }) {
  const pdf = useMutation({
    mutationFn: () => openInvoice(invoice, `/admin/billing/invoices/${invoice.id}/pdf`),
  });
  return (
    <View style={styles.open}>
      <Button
        title="Open PDF"
        variant="secondary"
        icon="open-outline"
        onPress={() => pdf.mutate()}
        loading={pdf.isPending}
      />
      <FormError message={pdf.isError ? errorMessage(pdf.error) : null} />
    </View>
  );
}

export function useBilling() {
  return useQuery({
    queryKey: BILLING_KEY,
    queryFn: async () => (await api.get<AgencyBilling>('/admin/billing')).data,
  });
}

/** Shown on every admin screen while an invoice is past its due date. */
export function OverdueBanner() {
  const billing = useBilling();
  const overdue = billing.data?.overdue;
  if (!overdue) {
    return null;
  }
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Icon name="warning-outline" size={18} color={colors.dangerText} />
      <Text style={styles.bannerText}>
        Invoice {overdue.number} ({formatMoney(overdue.amount, overdue.currency)}) is overdue. This agency will be
        suspended on {formatDate(overdue.suspends_on)} unless payment is received.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start' },
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  section: {
    fontSize: font.heading,
    fontWeight: weight.bold,
    color: colors.tertiary,
  },
  plan: { gap: 2 },
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
  text: { color: colors.text },
  muted: { color: colors.muted },
  open: { alignItems: 'flex-start', gap: space.xs },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: colors.dangerTint,
    borderBottomWidth: 1,
    borderBottomColor: colors.danger,
  },
  bannerText: {
    flex: 1,
    color: colors.dangerText,
    fontWeight: weight.semibold,
    fontSize: font.small,
  },
});
