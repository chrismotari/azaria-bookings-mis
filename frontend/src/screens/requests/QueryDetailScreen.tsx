import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { QueryDetail } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FormError } from '../../components/Field';
import { OfferingCard } from '../../components/OfferingCard';
import { QuerySummary } from '../../components/QuerySummary';
import { Screen } from '../../components/Screen';
import { StatusChip } from '../../components/StatusChip';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { RootStackParamList } from '../../navigation/types';
import { colors } from '../../theme';
import { confirmAction } from '../../utils/confirm';
import { formatDateTime } from '../../utils/format';
import { QUERY_STATUS } from '../../utils/queries';

export function QueryDetailScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'QueryDetail'>) {
  const { id } = route.params;
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['queries', 'detail', id],
    queryFn: async () => (await api.get<QueryDetail>(`/queries/${id}`)).data,
  });
  const close = useMutation({
    mutationFn: async () => (await api.post<QueryDetail>(`/queries/${id}/close`)).data,
    onSuccess: (data) => {
      queryClient.setQueryData(['queries', 'detail', id], data);
      return queryClient.invalidateQueries({ queryKey: ['queries'] });
    },
  });

  if (query.isPending) {
    return <LoadingState />;
  }
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  }

  const data = query.data;
  const status = QUERY_STATUS[data.status];
  const onClose = async () => {
    if (await confirmAction('Close this request?', 'We will stop looking for options for it.', 'Close request')) {
      close.mutate();
    }
  };

  return (
    <Screen maxWidth={900}>
      <Card>
        <View style={styles.header}>
          <Text style={styles.muted}>Sent {formatDateTime(data.created_at)}</Text>
          <StatusChip label={status.label} tone={status.tone} />
        </View>
        <QuerySummary query={data} />
        <FormError message={close.isError ? errorMessage(close.error) : null} />
        {data.status !== 'closed' ? (
          <View style={styles.actions}>
            <Button title="Close request" variant="secondary" onPress={onClose} loading={close.isPending} />
          </View>
        ) : null}
      </Card>

      <Text style={styles.section}>Options from Azaria Bookings</Text>
      {data.responses.length === 0 ? (
        <Text style={styles.muted}>No options yet. We will email you as soon as we have some.</Text>
      ) : (
        data.responses.map((response) => (
          <View key={response.id} style={styles.response}>
            <Text style={styles.muted}>{formatDateTime(response.created_at)}</Text>
            {response.message ? <Text style={styles.message}>{response.message}</Text> : null}
            <View style={styles.grid}>
              {response.offerings.map((offering) => (
                <View key={offering.id} style={styles.gridItem}>
                  <OfferingCard
                    offering={offering}
                    onPress={() => navigation.navigate('OfferingDetail', { id: offering.id, query: id })}
                  />
                </View>
              ))}
            </View>
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  actions: { flexDirection: 'row' },
  section: { fontSize: 20, fontWeight: '700', color: colors.text },
  response: { gap: 8 },
  message: { color: colors.text, fontSize: 15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridItem: { flexGrow: 1, flexBasis: 300, minWidth: 0 },
  muted: { color: colors.muted },
});
