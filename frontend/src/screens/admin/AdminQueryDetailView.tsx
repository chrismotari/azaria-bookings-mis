import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { AdminQueryDetail } from '../../api/types';
import { ActionBar } from '../../components/ActionBar';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { QuerySummary } from '../../components/QuerySummary';
import { StatusChip } from '../../components/StatusChip';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { colors, font, weight } from '../../theme';
import { formatDate, formatDateTime, formatPrice, stopsLabel, ticketClassLabel } from '../../utils/format';
import { QUERY_STATUS } from '../../utils/queries';

export function useAdminQuery(id: string) {
  return useQuery({
    queryKey: ['admin', 'queries', 'detail', id],
    queryFn: async () => (await api.get<AdminQueryDetail>(`/admin/queries/${id}`)).data,
  });
}

export function AdminQueryDetailView({ id }: { id: string }) {
  const navigation = useNavigation();
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
    <>
      {data.status === 'closed' ? (
        <Text style={styles.muted}>The customer closed this request.</Text>
      ) : (
        <ActionBar>
          <Button
            title={data.responses.length ? 'Send more options' : 'Respond'}
            onPress={() => navigation.navigate('AdminQueryRespond', { id })}
          />
        </ActionBar>
      )}

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

      <Text style={styles.section}>Responses sent</Text>
      {data.responses.length === 0 ? (
        <Text style={styles.muted}>None yet.</Text>
      ) : (
        data.responses.map((response) => (
          <Card key={response.id}>
            <Text style={styles.muted}>{formatDateTime(response.created_at)}</Text>
            {response.message ? <Text style={styles.text}>{response.message}</Text> : null}
            {response.offers.map((offer) => (
              <Text key={offer.id} style={styles.text}>
                • {offer.origin.code} → {offer.destination.code}, {formatDate(offer.departure_date)}, {offer.airline},{' '}
                {ticketClassLabel(offer.ticket_class)}, {stopsLabel(offer.stop_count)}, {formatPrice(offer.price)}
              </Text>
            ))}
          </Card>
        ))
      )}
    </>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  section: { fontSize: font.heading, fontWeight: weight.bold, color: colors.tertiary },
  text: { color: colors.text },
  muted: { color: colors.muted },
});
