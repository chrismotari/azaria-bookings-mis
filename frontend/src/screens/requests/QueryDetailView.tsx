import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { QueryDetail } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useConfirm } from '../../components/ConfirmDialog';
import { FormError } from '../../components/Field';
import { FlightRow } from '../../components/FlightRow';
import { Icon } from '../../components/Icon';
import { QuerySummary } from '../../components/QuerySummary';
import { StatusChip } from '../../components/StatusChip';
import { DetailError } from '../../components/DetailLayout';
import { LoadingState } from '../../components/StatusViews';
import { colors, font, radius, space, weight } from '../../theme';
import { formatDateTime } from '../../utils/format';
import { QUERY_STATUS } from '../../utils/queries';

export function QueryDetailView({ id }: { id: string }) {
  const navigation = useNavigation();
  const [width, setWidth] = useState(0);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
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
    return <DetailError error={query.error} onRetry={() => query.refetch()} notFound="Request not found" />;
  }

  const data = query.data;
  const status = QUERY_STATUS[data.status];
  const onClose = async () => {
    if (
      await confirm({
        title: 'Close this request?',
        message: 'We will stop looking for options for it.',
        confirmLabel: 'Close request',
        tone: 'danger',
      })
    ) {
      close.mutate();
    }
  };

  return (
    <>
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
          <Card key={response.id}>
            <View style={styles.responseHeader}>
              <Icon name="mail-outline" size={18} color={colors.primary} />
              <Text style={styles.responseTitle}>
                {response.offers.length} option{response.offers.length === 1 ? '' : 's'}
              </Text>
              <Text style={styles.small}>{formatDateTime(response.created_at)}</Text>
            </View>
            {response.message ? <Text style={styles.message}>{response.message}</Text> : null}
            {/* Rows stack when the panel or screen is too narrow for one line per offer. */}
            <View style={styles.rows} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
              {response.offers.map((offer) => (
                <FlightRow
                  key={offer.id}
                  offer={offer}
                  compact={width < ROW_WIDTH}
                  onPress={() =>
                    navigation.navigate('Main', { screen: 'Explore', params: { id: offer.id, query: id } })
                  }
                />
              ))}
            </View>
          </Card>
        ))
      )}
    </>
  );
}

/** Narrowest width that fits a flight row on one line. */
const ROW_WIDTH = 720;

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  actions: { flexDirection: 'row' },
  section: { fontSize: font.title, fontWeight: weight.heavy, color: colors.tertiary },
  responseHeader: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  responseTitle: { flex: 1, fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  message: {
    color: colors.text,
    fontSize: font.body,
    padding: space.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTint,
  },
  rows: { gap: space.md },
  small: { color: colors.muted, fontSize: font.small },
  muted: { color: colors.muted },
});
