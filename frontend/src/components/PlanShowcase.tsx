import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { BillingCycle, PlanTag, PublicPlan } from '../api/types';
import { colors, font, radius, shadow, shadowRaised, space, useIsWide, weight } from '../theme';
import { formatMoney } from '../utils/format';
import { Button } from './Button';
import { RichText } from './rich/RichText';
import { SegmentedControl } from './SegmentedControl';

/** The featured grid's places, always in this order. */
const FEATURED: Exclude<PlanTag, ''>[] = ['recommended', 'basic', 'advanced'];

export const TAG_LABEL: Record<Exclude<PlanTag, ''>, string> = {
  recommended: 'Recommended',
  basic: 'Basic',
  advanced: 'Advanced',
};

const CYCLES: { value: BillingCycle; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
];

/** Monthly price, else a twelfth of the annual one: for "cheapest first". */
const monthlyCost = (plan: PublicPlan) =>
  plan.monthly_price !== null ? Number(plan.monthly_price) : Number(plan.annual_price ?? 0) / 12;

const cheapestFirst = (a: PublicPlan, b: PublicPlan) => monthlyCost(a) - monthlyCost(b) || a.name.localeCompare(b.name);

type Props = {
  plans: PublicPlan[];
  /** The agency's running plans: shown as "Your plan" instead of a button. */
  currentPlanIds?: string[];
  /** Where the action buttons write to (payment is outside the system); no buttons without it. */
  contactEmail: string;
  /** "Get started" on the public page, "Ask to switch" in the agency app. */
  actionLabel: string;
};

/**
 * Plans as a pricing page: a Monthly / Annual switch, the Recommended, Basic and Advanced plans as featured cards
 * (in that order), every other subscription plan behind "Show all plans", and support plans in their own section.
 */
export function PlanShowcase({ plans, currentPlanIds = [], contactEmail, actionLabel }: Props) {
  const isWide = useIsWide();
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [showAll, setShowAll] = useState(false);

  const subscriptions = plans.filter((plan) => plan.kind === 'subscription');
  const featured = FEATURED.flatMap((tag) => subscriptions.filter((plan) => plan.tag === tag));
  // With nothing tagged, every plan is on show and there is nothing to reveal.
  const grid = featured.length ? featured : [...subscriptions].sort(cheapestFirst);
  const others = featured.length ? subscriptions.filter((plan) => !plan.tag).sort(cheapestFirst) : [];
  const support = plans.filter((plan) => plan.kind === 'support').sort(cheapestFirst);

  const card = (plan: PublicPlan, compact = false) => (
    <PlanCard
      key={plan.id}
      plan={plan}
      cycle={cycle}
      compact={compact}
      wide={isWide}
      current={currentPlanIds.includes(plan.id)}
      contactEmail={contactEmail}
      actionLabel={actionLabel}
    />
  );

  if (plans.length === 0) {
    return <Text style={styles.muted}>No plans are offered at the moment.</Text>;
  }
  return (
    <View style={styles.showcase}>
      <View style={styles.switch}>
        <SegmentedControl label="Billing cycle" options={CYCLES} value={cycle} onChange={setCycle} />
      </View>
      {grid.length ? (
        <View style={[styles.grid, isWide && styles.gridWide]}>{grid.map((plan) => card(plan))}</View>
      ) : null}
      {others.length ? (
        <>
          {showAll ? (
            <View style={[styles.grid, isWide && styles.gridWide]}>{others.map((plan) => card(plan))}</View>
          ) : null}
          <View style={styles.center}>
            <Button
              title={showAll ? 'Show fewer' : `Show all plans (${subscriptions.length})`}
              variant="secondary"
              icon={showAll ? 'chevron-up' : 'chevron-down'}
              onPress={() => setShowAll(!showAll)}
            />
          </View>
        </>
      ) : null}
      {support.length ? (
        <View style={styles.support}>
          <Text style={styles.section}>Add support</Text>
          <Text style={styles.muted}>Bought separately, on top of any plan.</Text>
          <View style={[styles.grid, isWide && styles.gridWide]}>{support.map((plan) => card(plan, true))}</View>
        </View>
      ) : null}
    </View>
  );
}

function PlanCard({
  plan,
  cycle,
  compact,
  wide,
  current,
  contactEmail,
  actionLabel,
}: {
  plan: PublicPlan;
  cycle: BillingCycle;
  compact: boolean;
  wide: boolean;
  current: boolean;
  contactEmail: string;
  actionLabel: string;
}) {
  const recommended = plan.tag === 'recommended';
  const price = cycle === 'monthly' ? plan.monthly_price : plan.annual_price;
  const saving =
    cycle === 'annual' && plan.monthly_price && plan.annual_price
      ? Math.round((1 - Number(plan.annual_price) / (12 * Number(plan.monthly_price))) * 100)
      : 0;
  const ask = () =>
    Linking.openURL(
      `mailto:${contactEmail}?subject=${encodeURIComponent(`${actionLabel}: ${plan.name} (${cycle === 'monthly' ? 'monthly' : 'annual'})`)}`,
    );

  return (
    <View
      style={[
        styles.card,
        wide && styles.cardWide,
        recommended && styles.cardRecommended,
        current && styles.cardCurrent,
      ]}
      accessibilityLabel={`${plan.name}${plan.tag ? `, ${TAG_LABEL[plan.tag]}` : ''}${current ? ', your plan' : ''}`}
    >
      {plan.tag || current ? (
        <View style={styles.chips}>
          {plan.tag ? (
            <Text style={[styles.tag, recommended && styles.tagRecommended]}>{TAG_LABEL[plan.tag]}</Text>
          ) : null}
          {current ? <Text style={[styles.tag, styles.tagCurrent]}>Your plan</Text> : null}
        </View>
      ) : null}
      <Text style={[styles.name, compact && styles.nameCompact]}>{plan.name}</Text>
      {price !== null ? (
        <View style={styles.priceRow}>
          <Text style={[styles.price, compact && styles.priceCompact]}>{formatMoney(price, plan.currency)}</Text>
          <Text style={styles.per}>{cycle === 'monthly' ? '/ month' : '/ year'}</Text>
        </View>
      ) : (
        <Text style={styles.only}>{cycle === 'monthly' ? 'Annual only' : 'Monthly only'}</Text>
      )}
      {saving > 0 ? <Text style={styles.saving}>Save {saving}%</Text> : <View style={styles.savingSpace} />}
      <View style={styles.description}>
        <RichText html={plan.description} />
      </View>
      {current ? null : contactEmail ? (
        <Button title={actionLabel} variant={recommended ? 'primary' : 'secondary'} onPress={ask} icon="mail-outline" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  showcase: { gap: space.xl },
  switch: { alignSelf: 'center', minWidth: 260 },
  grid: { gap: space.lg },
  gridWide: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', justifyContent: 'center' },
  center: { alignItems: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.xl,
    gap: space.sm,
    ...shadow,
  },
  cardWide: { flexGrow: 1, flexShrink: 1, flexBasis: 280, maxWidth: 400 },
  cardRecommended: { borderWidth: 2, borderColor: colors.primary, ...shadowRaised },
  cardCurrent: { backgroundColor: colors.primaryTint },
  chips: { flexDirection: 'row', gap: space.sm, minHeight: 24 },
  tag: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: font.small,
    fontWeight: weight.bold,
    overflow: 'hidden',
  },
  tagRecommended: { backgroundColor: colors.primary, color: colors.primaryText },
  tagCurrent: { backgroundColor: colors.surface, color: colors.primary },
  name: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  nameCompact: { fontSize: font.heading },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs, flexWrap: 'wrap' },
  price: { fontSize: font.display, fontWeight: weight.heavy, color: colors.text },
  priceCompact: { fontSize: font.title },
  per: { fontSize: font.body, color: colors.muted },
  only: { fontSize: font.heading, fontWeight: weight.semibold, color: colors.muted },
  saving: { fontSize: font.small, fontWeight: weight.bold, color: colors.successText },
  savingSpace: { height: 0 },
  description: { flexGrow: 1, paddingVertical: space.sm },
  support: { gap: space.md },
  section: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  muted: { color: colors.muted },
});
