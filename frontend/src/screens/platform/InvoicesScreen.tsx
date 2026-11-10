import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ReactNode, useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { AgencyInvoice, Invoice, Paginated } from '../../api/types';
import { ActionBar } from '../../components/ActionBar';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useConfirm } from '../../components/ConfirmDialog';
import { DateField } from '../../components/DateField';
import { DetailLayout } from '../../components/DetailLayout';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/Field';
import { Pagination } from '../../components/Pagination';
import { Screen } from '../../components/Screen';
import { SegmentedControl } from '../../components/SegmentedControl';
import { StatusChip, Tone, TONES } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { Column, Table, TableRow } from '../../components/Table';
import { TripCard } from '../../components/TripCard';
import { PlatformTabParamList } from '../../navigation/types';
import { colors, font, radius, space, useIsWide, weight } from '../../theme';
import { downloadFile } from '../../utils/download';
import { formatDate, formatMoney, todayInNairobi } from '../../utils/format';
import { AGENCIES_KEY, INVOICES_KEY } from './keys';

/** Unpaid invoices past their due date show as Overdue. */
export function invoiceStatus(invoice: AgencyInvoice): {
  label: string;
  tone: Tone;
} {
  if (invoice.status === 'paid') {
    return { label: 'Paid', tone: 'success' };
  }
  if (invoice.status === 'void') {
    return { label: 'Void', tone: 'neutral' };
  }
  return invoice.overdue ? { label: 'Overdue', tone: 'danger' } : { label: 'Unpaid', tone: 'warning' };
}

export const period = (invoice: AgencyInvoice) =>
  `${formatDate(invoice.period_start)} – ${formatDate(invoice.period_end)}`;

/** Web only: saves the invoice's PDF. */
export function downloadInvoice(invoice: AgencyInvoice, path: string) {
  return downloadFile(path, `${invoice.number}.pdf`);
}

type Filter = 'all' | 'unpaid' | 'overdue' | 'paid' | 'void';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
];

const COLUMNS: Column[] = [
  { label: 'Number', flex: 1.4 },
  { label: 'Agency', flex: 1.8 },
  { label: 'Period', flex: 2.4 },
  { label: 'Amount', flex: 1.3 },
  { label: 'Due', flex: 1.6 },
  { label: 'Status', flex: 1.1 },
];

export function InvoicesScreen({ navigation, route }: BottomTabScreenProps<PlatformTabParamList, 'PlatformInvoices'>) {
  const selected = route.params?.id;
  const close = useCallback(() => navigation.setParams({ id: undefined }), [navigation]);
  const asTable = useIsWide() && selected === undefined;
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const invoices = useQuery({
    queryKey: [...INVOICES_KEY, 'list', filter, page],
    queryFn: async () => {
      const params =
        filter === 'overdue' ? { page, overdue: 'true' } : filter === 'all' ? { page } : { page, status: filter };
      return (await api.get<Paginated<Invoice>>('/platform/invoices', { params })).data;
    },
    placeholderData: keepPreviousData,
  });
  const open = (invoice: Invoice) => navigation.setParams({ id: invoice.id });

  return (
    <DetailLayout
      title="Invoice"
      backLabel="All invoices"
      onClose={close}
      detail={selected ? <InvoiceDetailView key={selected} id={selected} /> : null}
      list={
        <Screen card>
          <Text style={styles.title}>Invoices</Text>
          <Text style={styles.muted}>
            Issued automatically before each period starts. Payment happens outside the system: mark an invoice paid
            once the money has arrived.
          </Text>
          <SegmentedControl
            label="Status"
            options={FILTERS}
            value={filter}
            wrap
            onChange={(value) => {
              setFilter(value);
              setPage(1);
            }}
          />
          {invoices.isPending ? (
            <LoadingState />
          ) : invoices.isError ? (
            <ErrorState error={invoices.error} onRetry={() => invoices.refetch()} />
          ) : invoices.data.results.length === 0 ? (
            <EmptyState
              icon="document-text-outline"
              title={filter === 'all' ? 'No invoices yet' : 'No matching invoices'}
              message={
                filter === 'all'
                  ? "Invoices appear here once an agency's plan starts."
                  : 'No invoice has that status right now.'
              }
            />
          ) : (
            <>
              {asTable ? (
                <Table columns={COLUMNS}>
                  {invoices.data.results.map((invoice) => {
                    const status = invoiceStatus(invoice);
                    return (
                      <TableRow
                        key={invoice.id}
                        columns={COLUMNS}
                        onPress={() => open(invoice)}
                        accessibilityLabel={`${invoice.number}, ${invoice.tenant.name}, ${status.label}`}
                        cells={[
                          <Text key="number" style={styles.name}>
                            {invoice.number}
                          </Text>,
                          <Text key="agency" style={styles.text} numberOfLines={1}>
                            {invoice.tenant.name}
                          </Text>,
                          <Text key="period" style={styles.text}>
                            {period(invoice)}
                          </Text>,
                          <Text key="amount" style={styles.text}>
                            {formatMoney(invoice.amount, invoice.currency)}
                          </Text>,
                          <Text key="due" style={styles.text}>
                            {formatDate(invoice.due_on)}
                          </Text>,
                          <StatusChip key="status" label={status.label} tone={status.tone} />,
                        ]}
                      />
                    );
                  })}
                </Table>
              ) : (
                <View style={styles.cards}>
                  {invoices.data.results.map((invoice) => (
                    <InvoiceCard
                      key={invoice.id}
                      invoice={invoice}
                      agency={invoice.tenant.name}
                      selected={invoice.id === selected}
                      onPress={() => open(invoice)}
                    />
                  ))}
                </View>
              )}
              <Pagination page={page} count={invoices.data.count} onChange={setPage} />
            </>
          )}
        </Screen>
      }
    />
  );
}

/**
 * An invoice in a card list; also used in the agency drawer and the agency's own Billing screen. With onPress it
 * opens the invoice; without, it is a static card that can hold an action (e.g. Download PDF).
 */
export function InvoiceCard({
  invoice,
  agency,
  selected = false,
  onPress,
  action,
}: {
  invoice: AgencyInvoice;
  agency?: string;
  selected?: boolean;
  onPress?: () => void;
  action?: ReactNode;
}) {
  const status = invoiceStatus(invoice);
  const content = (
    <>
      <View style={styles.between}>
        <Text style={styles.name}>{invoice.number}</Text>
        <StatusChip label={status.label} tone={status.tone} />
      </View>
      {agency ? <Text style={styles.text}>{agency}</Text> : null}
      <Text style={styles.text}>
        {invoice.plan_name} · {period(invoice)}
      </Text>
      <View style={styles.between}>
        <Text style={styles.amount}>{formatMoney(invoice.amount, invoice.currency)}</Text>
        <Text style={styles.muted}>
          {invoice.status === 'paid' && invoice.paid_on
            ? `Paid ${formatDate(invoice.paid_on)}`
            : `Due ${formatDate(invoice.due_on)}`}
        </Text>
      </View>
      {action}
    </>
  );
  if (!onPress) {
    return <View style={[styles.staticCard, { borderLeftColor: TONES[status.tone].color }]}>{content}</View>;
  }
  return (
    <TripCard
      tone={status.tone}
      selected={selected}
      onPress={onPress}
      accessibilityLabel={`${invoice.number}${agency ? `, ${agency}` : ''}, ${status.label}`}
    >
      {content}
    </TripCard>
  );
}

const detailKey = (id: string) => [...INVOICES_KEY, 'detail', id];

export function InvoiceDetailView({ id }: { id: string }) {
  const invoice = useQuery({
    queryKey: detailKey(id),
    queryFn: async () => (await api.get<Invoice>(`/platform/invoices/${id}`)).data,
  });
  if (invoice.isPending) {
    return <LoadingState />;
  }
  if (invoice.isError) {
    return <ErrorState error={invoice.error} onRetry={() => invoice.refetch()} />;
  }
  return <InvoiceDetail invoice={invoice.data} />;
}

type Action = 'mark-paid' | 'mark-unpaid' | 'void' | 'resend';

function InvoiceDetail({ invoice }: { invoice: Invoice }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [payOpen, setPayOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: async ({ action, body }: { action: Action; body?: object }) =>
      (await api.post<Invoice>(`/platform/invoices/${invoice.id}/${action}`, body)).data,
    onSuccess: (data, { action }) => {
      queryClient.setQueryData(detailKey(invoice.id), data);
      setNotice(action === 'resend' ? `Sent again to the agency's billing email.` : null);
      // Paying can reactivate the agency, so its drawer and the list refresh too.
      void queryClient.invalidateQueries({ queryKey: INVOICES_KEY });
      return queryClient.invalidateQueries({ queryKey: AGENCIES_KEY });
    },
  });
  const download = useMutation({
    mutationFn: () => downloadInvoice(invoice, `/platform/invoices/${invoice.id}/pdf`),
  });

  const run = async (action: Exclude<Action, 'mark-paid'>) => {
    const dialogs = {
      'mark-unpaid': {
        title: 'Mark this invoice unpaid?',
        message:
          'Use this to correct a payment recorded by mistake. If it is more than a month overdue, the agency is suspended on the next daily check.',
        confirmLabel: 'Mark unpaid',
        tone: 'danger' as const,
      },
      void: {
        title: 'Void this invoice?',
        message: 'A voided invoice is no longer owed and cannot be paid. Use this for an invoice issued by mistake.',
        confirmLabel: 'Void',
        tone: 'danger' as const,
      },
      resend: {
        title: 'Send this invoice again?',
        message: "It is emailed with its PDF to the agency's billing email.",
        confirmLabel: 'Send again',
        tone: 'primary' as const,
      },
    };
    if (await confirm(dialogs[action])) {
      act.mutate({ action });
    }
  };

  const status = invoiceStatus(invoice);
  return (
    <>
      <ActionBar>
        <Button
          title="Download PDF"
          variant="secondary"
          icon="download-outline"
          onPress={() => download.mutate()}
          loading={download.isPending}
        />
        {invoice.status === 'unpaid' ? (
          <>
            <Button title="Resend" variant="secondary" onPress={() => run('resend')} disabled={act.isPending} />
            <Button title="Void" variant="danger" onPress={() => run('void')} disabled={act.isPending} />
            <Button title="Mark paid" onPress={() => setPayOpen(true)} loading={act.isPending} />
          </>
        ) : invoice.status === 'paid' ? (
          <Button title="Mark unpaid" variant="danger" onPress={() => run('mark-unpaid')} loading={act.isPending} />
        ) : null}
      </ActionBar>
      <FormError
        message={act.isError ? errorMessage(act.error) : download.isError ? errorMessage(download.error) : null}
      />
      {notice ? <Text style={styles.saved}>{notice}</Text> : null}

      <Card>
        <View style={styles.between}>
          <Text style={styles.section}>{invoice.number}</Text>
          <StatusChip label={status.label} tone={status.tone} />
        </View>
        <Detail label="Agency" value={invoice.tenant.name} />
        <Detail
          label="Plan"
          value={`${invoice.plan_name} (${invoice.billing_cycle === 'monthly' ? 'monthly' : 'annual'})`}
        />
        <Detail label="Period" value={period(invoice)} />
        <Detail label="Amount" value={formatMoney(invoice.amount, invoice.currency)} />
        <Detail label="Issued" value={formatDate(invoice.issued_on)} />
        <Detail label="Due" value={formatDate(invoice.due_on)} />
        {invoice.paid_on ? <Detail label="Paid" value={formatDate(invoice.paid_on)} /> : null}
        {invoice.suspends_on && invoice.overdue ? (
          <Text style={styles.warning}>
            Unless it is paid, the agency is suspended on {formatDate(invoice.suspends_on)}.
          </Text>
        ) : null}
        {invoice.suspension_waived && invoice.status === 'unpaid' ? (
          <Text style={styles.muted}>
            You reactivated the agency while this invoice was overdue: it no longer suspends the agency.
          </Text>
        ) : null}
      </Card>
      {payOpen ? (
        <MarkPaidDialog
          invoice={invoice}
          busy={act.isPending}
          error={act.isError ? errorMessage(act.error) : null}
          onClose={() => {
            setPayOpen(false);
            act.reset();
          }}
          onConfirm={(paid_on) =>
            act.mutate({ action: 'mark-paid', body: { paid_on } }, { onSuccess: () => setPayOpen(false) })
          }
        />
      ) : null}
    </>
  );
}

function MarkPaidDialog({
  invoice,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  invoice: Invoice;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (paidOn: string) => void;
}) {
  const [paidOn, setPaidOn] = useState(todayInNairobi());
  return (
    <Dialog
      open
      title="Mark paid"
      onClose={onClose}
      busy={busy}
      error={error}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={busy} />
          <Button title="Mark paid" onPress={() => onConfirm(paidOn)} loading={busy} disabled={!paidOn} />
        </>
      }
    >
      <Text style={styles.text}>
        Record that {invoice.tenant.name} paid {formatMoney(invoice.amount, invoice.currency)} for {invoice.number}. If
        the agency was suspended for non-payment and nothing else is overdue, it is reactivated.
      </Text>
      <DateField label="Paid on" value={paidOn} onChange={setPaidOn} />
    </Dialog>
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

const styles = StyleSheet.create({
  staticCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    padding: space.lg,
    gap: space.md,
  },
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  section: {
    fontSize: font.heading,
    fontWeight: weight.bold,
    color: colors.tertiary,
  },
  cards: { gap: space.md },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  name: {
    fontSize: font.body,
    fontWeight: weight.bold,
    color: colors.text,
    flexShrink: 1,
  },
  amount: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  text: { color: colors.text },
  muted: { color: colors.muted },
  warning: { color: colors.dangerText, fontWeight: weight.semibold },
  saved: { color: colors.successText, fontWeight: weight.semibold },
  detail: { gap: 2 },
  detailLabel: { fontSize: font.small, color: colors.muted },
});
