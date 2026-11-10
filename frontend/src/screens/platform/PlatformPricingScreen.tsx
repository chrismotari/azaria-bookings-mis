import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { PublicPlans } from '../../api/types';
import { PlanShowcase } from '../../components/PlanShowcase';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { colors, font, space, weight } from '../../theme';

/** The public pricing page on the root host, for agencies that are not customers yet. */
export function PlatformPricingScreen() {
  const plans = useQuery({
    queryKey: ['public', 'plans'],
    queryFn: async () => (await api.get<PublicPlans>('/platform/public-plans')).data,
  });
  return (
    <Screen maxWidth={1280}>
      <View style={styles.header}>
        <Text style={styles.title}>Plans and pricing</Text>
        <Text style={styles.lead}>
          Choose the plan that fits your agency. Every plan gives you your own booking site; pay monthly or yearly.
        </Text>
      </View>
      {plans.isPending ? (
        <LoadingState />
      ) : plans.isError ? (
        <ErrorState error={plans.error} onRetry={() => plans.refetch()} />
      ) : (
        <PlanShowcase
          plans={plans.data.plans}
          contactEmail={plans.data.billing_contact_email}
          actionLabel="Get started"
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: space.sm, marginTop: space.lg },
  title: { fontSize: font.display, fontWeight: weight.heavy, color: colors.text, textAlign: 'center' },
  lead: { fontSize: font.heading, color: colors.muted, textAlign: 'center', maxWidth: 640 },
});
