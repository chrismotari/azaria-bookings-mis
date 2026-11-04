import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { api } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { AdminQueryDetail } from '../../api/types';
import { Button } from '../../components/Button';
import { FormError } from '../../components/Field';
import { FormFooter, FormSection } from '../../components/FormSection';
import { OfferFilterValues } from '../../components/OfferFilterFields';
import { QuerySummary } from '../../components/QuerySummary';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { RootStackParamList } from '../../navigation/types';
import { colors, font, weight } from '../../theme';
import { todayInNairobi } from '../../utils/format';
import { useAdminQuery } from './AdminQueryDetailView';
import { ChosenOffers, MessageField, OfferOptionsSections, useOfferOptions } from './OfferOptions';
import { OfferFormValues } from './offerSchema';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminQueryRespond'>;

export function AdminQueryRespondScreen({ navigation, route }: Props) {
  const query = useAdminQuery(route.params.id);
  if (query.isPending) {
    return <LoadingState />;
  }
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  }
  return (
    <RespondForm
      query={query.data}
      onSent={() => navigation.popTo('AdminTabs', { screen: 'AdminRequests', params: { id: query.data.id } })}
    />
  );
}

/** Existing-offer search starts from the customer's own criteria. */
function initialFilters(query: AdminQueryDetail): OfferFilterValues {
  const airport = (value: AdminQueryDetail['origin']) => ({ text: value?.code ?? '', airport: value });
  return {
    origin: airport(query.origin),
    destination: airport(query.destination),
    date_from: query.date_from,
    date_to: query.date_to ?? '',
    price_min: '',
    price_max: '',
    ticket_class: query.ticket_class,
    max_stopovers: query.max_stopovers === null ? '' : String(query.max_stopovers),
  };
}

function customOfferDefaults(query: AdminQueryDetail): OfferFormValues {
  return {
    origin: query.origin,
    destination: query.destination,
    departure_date: query.date_from,
    ticket_class: query.ticket_class || 'economy',
    price: '',
    stops: [],
    airline: null,
    valid_until: todayInNairobi(),
    is_public: false,
  };
}

function RespondForm({ query, onSent }: { query: AdminQueryDetail; onSent: () => void }) {
  const queryClient = useQueryClient();
  const options = useOfferOptions(initialFilters(query), customOfferDefaults(query));
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const send = async () => {
    setFormError(null);
    if (options.count === 0) {
      setFormError('Select or add at least one offer.');
      return;
    }
    setSending(true);
    try {
      await api.post(`/admin/queries/${query.id}/respond`, { message: message.trim(), ...options.body() });
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      onSent();
    } catch (error) {
      setFormError(options.applyErrors(error) ? 'Some custom offers need fixing.' : errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen maxWidth={1000}>
      <Text style={styles.title}>Respond to {query.user.full_name}</Text>
      <FormSection title="The request">
        <QuerySummary query={query} />
      </FormSection>

      <OfferOptionsSections
        options={options}
        existingDescription="Active offers, starting from the customer's criteria."
      />

      <FormSection title="Your response">
        <ChosenOffers options={options} />
        <MessageField value={message} onChange={setMessage} />
      </FormSection>
      <FormError message={formError} />
      <FormFooter>
        <Button title="Send response" onPress={send} loading={sending} />
      </FormFooter>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
});
