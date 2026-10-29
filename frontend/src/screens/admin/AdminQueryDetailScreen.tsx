import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { AdminQueryDetail } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { QuerySummary } from '../../components/QuerySummary';
import { Screen } from '../../components/Screen';
import { StatusChip } from '../../components/StatusChip';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { RootStackParamList } from '../../navigation/types';
import { colors } from '../../theme';
import { formatDate, formatDateTime, formatPrice, stopoversLabel, ticketClassLabel } from '../../utils/format';
import { QUERY_STATUS } from '../../utils/queries';

export function useAdminQuery(id: number) {
  return useQuery({
    queryKey: ['admin', 'queries', 'detail', id],
    queryFn: async () => (await api.get<AdminQueryDetail>(`/admin/queries/${id}`)).data,
  });
}

export function AdminQueryDetailScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'AdminQueryDetail'>) {
  const { id } = route.params;
  const query = useAdminQuery(id);

  if (query.isPending) {
    return <LoadingState />;
  }
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  }

  const data = query.data;
  const status = QUERY_STATUS[data.status];
  return (
    <Screen maxWidth={900}>
      <Card>
        <View style={styles.header}>
          <Text style={styles.muted}>Received {formatDateTime(data.created_at)}</Text>
          <StatusChip label={status.label} tone={status.tone} />
        </View>
        <QuerySummary query={data} />
      </Card>

      <Card>
        <Text style={styles.section}>Customer</Text>
        <Text style={styles.text}>{data.user.full_name}</Text>
        <Text style={styles.text}>{data.user.email}</Text>
        {data.user.phone ? <Text style={styles.text}>{data.user.phone}</Text> : null}
      </Card>

      {data.status === 'closed' ? (
        <Text style={styles.muted}>The customer closed this request.</Text>
      ) : (
        <View style={styles.actions}>
          <Button
            title={data.responses.length ? 'Send more options' : 'Respond'}
            onPress={() => navigation.navigate('AdminQueryRespond', { id })}
          />
        </View>
      )}

      <Text style={styles.section}>Responses sent</Text>
      {data.responses.length === 0 ? (
        <Text style={styles.muted}>None yet.</Text>
      ) : (
        data.responses.map((response) => (
          <Card key={response.id}>
            <Text style={styles.muted}>{formatDateTime(response.created_at)}</Text>
            {response.message ? <Text style={styles.text}>{response.message}</Text> : null}
            {response.offerings.map((offering) => (
              <Text key={offering.id} style={styles.text}>
                • {offering.origin.code} → {offering.destination.code}, {formatDate(offering.departure_date)},{' '}
                {offering.airline}, {ticketClassLabel(offering.ticket_class)}, {stopoversLabel(offering.stopovers)},{' '}
                {formatPrice(offering.price)}
              </Text>
            ))}
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  section: { fontSize: 18, fontWeight: '700', color: colors.text },
  actions: { flexDirection: 'row' },
  text: { color: colors.text },
  muted: { color: colors.muted },
});
