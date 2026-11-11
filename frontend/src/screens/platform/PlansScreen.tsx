import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { api } from '../../api/client';
import { applyServerErrors } from '../../api/errors';
import { Paginated, Plan, PlanKind, PlanTag } from '../../api/types';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FieldGrid } from '../../components/Field';
import { Pagination } from '../../components/Pagination';
import { TAG_LABEL } from '../../components/PlanShowcase';
import { textOf } from '../../components/rich/css';
import { RichTextEditor } from '../../components/rich/RichTextEditor';
import { Screen } from '../../components/Screen';
import { SegmentedControl } from '../../components/SegmentedControl';
import { SelectField } from '../../components/SelectField';
import { StatusChip } from '../../components/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '../../components/StatusViews';
import { Column, Table, TableRow } from '../../components/Table';
import { TextField } from '../../components/TextField';
import { Toggle } from '../../components/Toggle';
import { TripCard } from '../../components/TripCard';
import { colors, font, space, useIsWide, weight } from '../../theme';
import { formatMoney } from '../../utils/format';
import { PLANS_KEY } from './keys';

const KINDS: { value: PlanKind; label: string }[] = [
  { value: 'subscription', label: 'Subscription' },
  { value: 'support', label: 'Support' },
];

const COLUMNS: Column[] = [
  { label: 'Name', flex: 2.4 },
  { label: 'Tag', flex: 1.2 },
  { label: 'Monthly', flex: 1.3 },
  { label: 'Annual', flex: 1.3 },
  { label: 'Status', flex: 1.1 },
];

const TAGS: { value: PlanTag; label: string }[] = [
  { value: '', label: 'No tag' },
  { value: 'recommended', label: 'Recommended (1st card)' },
  { value: 'basic', label: 'Basic (2nd card)' },
  { value: 'advanced', label: 'Advanced (3rd card)' },
];

function PlanTagChip({ plan }: { plan: Plan }) {
  return plan.tag ? (
    <StatusChip label={TAG_LABEL[plan.tag]} tone={plan.tag === 'recommended' ? 'info' : 'neutral'} />
  ) : (
    <Text style={styles.muted}>—</Text>
  );
}

const price = (amount: string | null, currency: string) => (amount === null ? '—' : formatMoney(amount, currency));

export function PlansScreen() {
  const asTable = useIsWide();
  const [kind, setKind] = useState<PlanKind>('subscription');
  const [page, setPage] = useState(1);
  // A plan to edit, 'new', or null when the dialog is closed.
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const plans = useQuery({
    queryKey: [...PLANS_KEY, kind, page],
    queryFn: async () =>
      (
        await api.get<Paginated<Plan>>('/platform/plans', {
          params: { kind, page },
        })
      ).data,
    placeholderData: keepPreviousData,
  });

  return (
    <Screen card>
      <View style={styles.header}>
        <Text style={styles.title}>Plans</Text>
        <View style={styles.headerActions}>
          {Platform.OS === 'web' ? (
            <Button
              title="View pricing page"
              variant="secondary"
              icon="open-outline"
              onPress={() => window.open('/pricing', '_blank', 'noopener')}
            />
          ) : null}
          <Button title="New plan" icon="add-outline" onPress={() => setEditing('new')} />
        </View>
      </View>
      <Text style={styles.muted}>
        Subscription plans are what agencies use the platform on; support plans are bought separately. An agency has at
        most one of each.
      </Text>
      <SegmentedControl
        label="Kind"
        options={KINDS}
        value={kind}
        onChange={(value) => {
          setKind(value);
          setPage(1);
        }}
      />
      {plans.isPending ? (
        <LoadingState />
      ) : plans.isError ? (
        <ErrorState error={plans.error} onRetry={() => plans.refetch()} />
      ) : plans.data.results.length === 0 ? (
        <EmptyState
          icon="layers-outline"
          title={`No ${kind} plans yet`}
          message="Add one with New plan. Plans can be renamed, repriced and deactivated later."
        />
      ) : (
        <>
          {asTable ? (
            <Table columns={COLUMNS}>
              {plans.data.results.map((plan) => (
                <TableRow
                  key={plan.id}
                  columns={COLUMNS}
                  onPress={() => setEditing(plan)}
                  accessibilityLabel={`${plan.name}, ${plan.is_active ? 'active' : 'inactive'}`}
                  cells={[
                    <View key="name" style={styles.nameCell}>
                      <Text style={styles.name} numberOfLines={1}>
                        {plan.name}
                      </Text>
                      {plan.description ? (
                        <Text style={styles.muted} numberOfLines={1}>
                          {textOf(plan.description)}
                        </Text>
                      ) : null}
                    </View>,
                    <PlanTagChip key="tag" plan={plan} />,
                    <Text key="monthly" style={styles.text}>
                      {price(plan.monthly_price, plan.currency)}
                    </Text>,
                    <Text key="annual" style={styles.text}>
                      {price(plan.annual_price, plan.currency)}
                    </Text>,
                    <PlanStatus key="status" plan={plan} />,
                  ]}
                />
              ))}
            </Table>
          ) : (
            <View style={styles.cards}>
              {plans.data.results.map((plan) => (
                <TripCard
                  key={plan.id}
                  tone={plan.is_active ? 'success' : 'neutral'}
                  selected={false}
                  onPress={() => setEditing(plan)}
                  accessibilityLabel={`${plan.name}, ${plan.is_active ? 'active' : 'inactive'}`}
                >
                  <View style={styles.between}>
                    <Text style={styles.name} numberOfLines={1}>
                      {plan.name}
                    </Text>
                    <View style={styles.chips}>
                      <PlanTagChip plan={plan} />
                      <PlanStatus plan={plan} />
                    </View>
                  </View>
                  <Text style={styles.text}>
                    {price(plan.monthly_price, plan.currency)} a month · {price(plan.annual_price, plan.currency)} a
                    year
                  </Text>
                  {plan.description ? (
                    <Text style={styles.muted} numberOfLines={2}>
                      {textOf(plan.description)}
                    </Text>
                  ) : null}
                </TripCard>
              ))}
            </View>
          )}
          <Pagination page={page} count={plans.data.count} onChange={setPage} />
        </>
      )}
      {editing ? (
        <PlanDialog plan={editing === 'new' ? null : editing} kind={kind} onClose={() => setEditing(null)} />
      ) : null}
    </Screen>
  );
}

function PlanStatus({ plan }: { plan: Plan }) {
  return plan.is_active ? <StatusChip label="Active" tone="success" /> : <StatusChip label="Inactive" tone="neutral" />;
}

const PRICE = /^\d{1,10}(\.\d{1,2})?$/;

const priceField = z
  .string()
  .trim()
  .refine((value) => value === '' || PRICE.test(value), 'Enter an amount such as 49 or 49.50.');

const schema = z
  .object({
    name: z.string().trim().min(1, "Enter the plan's name.").max(100),
    kind: z.enum(['subscription', 'support']),
    tag: z.enum(['', 'recommended', 'basic', 'advanced']),
    description: z.string(),
    monthly_price: priceField,
    annual_price: priceField,
    is_active: z.boolean(),
  })
  .refine((values) => values.monthly_price !== '' || values.annual_price !== '', {
    message: 'Set a monthly price, an annual price or both.',
    path: ['monthly_price'],
  });

type Values = z.infer<typeof schema>;

const FIELDS = ['name', 'kind', 'tag', 'description', 'monthly_price', 'annual_price', 'is_active'] as const;

/** Creates a plan (of the kind on show) or edits one; its kind is fixed once created. */
function PlanDialog({ plan, kind, onClose }: { plan: Plan | null; kind: PlanKind; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, formState, watch } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: plan?.name ?? '',
      kind: plan?.kind ?? kind,
      tag: plan?.tag ?? '',
      description: plan?.description ?? '',
      monthly_price: plan?.monthly_price ?? '',
      annual_price: plan?.annual_price ?? '',
      is_active: plan?.is_active ?? true,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const body = {
      ...values,
      // Only subscription plans carry a tag.
      tag: values.kind === 'subscription' ? values.tag : '',
      monthly_price: values.monthly_price || null,
      annual_price: values.annual_price || null,
    };
    try {
      if (plan) {
        await api.patch(`/platform/plans/${plan.id}`, body);
      } else {
        await api.post('/platform/plans', body);
      }
      await queryClient.invalidateQueries({ queryKey: PLANS_KEY });
      onClose();
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS));
    }
  });

  const subscription = watch('kind') === 'subscription';
  const text = (name: 'name' | 'monthly_price' | 'annual_price', label: string, numeric = false) => (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          label={label}
          value={field.value}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          error={fieldState.error?.message}
          keyboardType={numeric ? 'decimal-pad' : 'default'}
        />
      )}
    />
  );

  return (
    <Dialog
      open
      title={plan ? 'Edit plan' : 'New plan'}
      size="wide"
      onClose={onClose}
      busy={formState.isSubmitting}
      error={formError}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={formState.isSubmitting} />
          <Button title={plan ? 'Save plan' : 'Create plan'} onPress={onSubmit} loading={formState.isSubmitting} />
        </>
      }
    >
      {plan ? (
        <Text style={styles.muted}>
          Changes apply to invoices issued from now on; invoices already issued keep their plan and amount.
        </Text>
      ) : (
        <Controller
          control={control}
          name="kind"
          render={({ field }) => (
            <SegmentedControl label="Kind" options={KINDS} value={field.value} onChange={field.onChange} />
          )}
        />
      )}
      {text('name', 'Name')}
      {subscription ? (
        <Controller
          control={control}
          name="tag"
          render={({ field, fieldState }) => (
            <>
              <SelectField
                label="Place on the plans page"
                options={TAGS}
                value={field.value}
                onChange={field.onChange}
              />
              {fieldState.error ? <Text style={styles.error}>{fieldState.error.message}</Text> : null}
            </>
          )}
        />
      ) : null}
      <Controller
        control={control}
        name="description"
        render={({ field, fieldState }) => (
          <RichTextEditor
            label="Description (optional): what the plan includes"
            value={field.value}
            onChange={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <FieldGrid columns={2}>
        {text('monthly_price', 'Monthly price', true)}
        {text('annual_price', 'Annual price', true)}
      </FieldGrid>
      <Text style={styles.muted}>Leave a price empty if the plan is not offered on that cycle.</Text>
      <Controller
        control={control}
        name="is_active"
        render={({ field }) => (
          <Toggle label="Offered (can be chosen for new subscriptions)" value={field.value} onChange={field.onChange} />
        )}
      />
    </Dialog>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chips: { flexDirection: 'row', gap: space.xs, alignItems: 'center' },
  error: { color: colors.dangerText, fontSize: font.small },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  cards: { gap: space.md },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
  },
  nameCell: { gap: 2, flexShrink: 1 },
  name: {
    fontSize: font.body,
    fontWeight: weight.bold,
    color: colors.text,
    flexShrink: 1,
  },
  text: { color: colors.text },
  muted: { color: colors.muted },
});
