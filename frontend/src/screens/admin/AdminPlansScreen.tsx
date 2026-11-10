import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { AgencyPlans } from '../../api/types';
import { Button } from '../../components/Button';
import { PlanShowcase } from '../../components/PlanShowcase';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { colors, font, space, weight } from '../../theme';

/** The plans the agency can be on, with its own marked; switching is arranged with the platform by email. */
export function AdminPlansScreen() {
  const navigation = useNavigation();
  const plans = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: async () => (await api.get<AgencyPlans>('/admin/plans')).data,
  });
  return (
    <Screen maxWidth={1280}>
      <View style={styles.header}>
        <View style={styles.back}>
          <Button
            title="← Billing"
            variant="link"
            onPress={() => navigation.navigate('AdminTabs', { screen: 'AdminBilling' })}
          />
        </View>
        <Text style={styles.title}>Plans</Text>
        <Text style={styles.muted}>
          Your agency's plan is marked. To change plans, ask us and we update your billing from the next invoice.
        </Text>
      </View>
      {plans.isPending ? (
        <LoadingState />
      ) : plans.isError ? (
        <ErrorState error={plans.error} onRetry={() => plans.refetch()} />
      ) : (
        <PlanShowcase
          plans={plans.data.plans}
          currentPlanIds={plans.data.current_plan_ids}
          contactEmail={plans.data.billing_contact_email}
          actionLabel="Ask to switch"
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  back: { alignSelf: 'flex-start' },
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  muted: { color: colors.muted },
});
