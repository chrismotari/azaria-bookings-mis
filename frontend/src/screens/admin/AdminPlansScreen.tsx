import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AgencyPlans } from '../../api/types';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { billed, enquirySubject, PlanShowcase } from '../../components/PlanShowcase';
import { AGENCY_TO_PLATFORM, CHATS_KEY } from '../../support/api';
import { ChatPrefill } from '../../support/launcher';
import { NewChatForm } from '../../support/NewChatForm';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { colors, font, space, weight } from '../../theme';

/** The plans the agency can be on, with its own marked; switching is arranged with the platform by email. */
export function AdminPlansScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // A plan enquiry being written: sent to the platform as a chat from this agency.
  const [enquiry, setEnquiry] = useState<ChatPrefill | null>(null);
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
          Your agency's plan is marked. To change plans, ask us: your request goes to Azaria Bookings as a chat
          (Settings › Support), and we update your billing from the next invoice.
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
          actionLabel="Ask to switch"
          onEnquire={(plan, cycle) =>
            setEnquiry({
              subject: enquirySubject(plan, cycle),
              message: `We would like to switch to the ${plan.name} plan, billed ${billed(cycle)}.`,
            })
          }
        />
      )}
      {enquiry ? (
        <Dialog open title="Ask to switch plans" size="large" onClose={() => setEnquiry(null)} footer={null}>
          <NewChatForm
            email={user?.email ?? ''}
            path={AGENCY_TO_PLATFORM.chats}
            subject={enquiry.subject}
            message={enquiry.message}
            onSent={(chat) => {
              setEnquiry(null);
              void queryClient.invalidateQueries({ queryKey: CHATS_KEY });
              navigation.navigate('AdminTabs', { screen: 'AdminSupport', params: chat ? { id: chat.id } : undefined });
            }}
          />
        </Dialog>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  back: { alignSelf: 'flex-start' },
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  muted: { color: colors.muted },
});
