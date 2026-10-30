import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigation } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { applyServerErrors } from '../../api/errors';
import { AdminOffer } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FormError } from '../../components/Field';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { RootStackParamList } from '../../navigation/types';
import { colors } from '../../theme';
import { OfferFields } from './OfferFields';
import { OfferFormValues, offerSchema, toOfferBody } from './offerSchema';

const FIELDS = [
  'origin',
  'destination',
  'departure_date',
  'ticket_class',
  'price',
  'stopovers',
  'airline',
  'valid_until',
  'is_public',
] as const;

const EMPTY: OfferFormValues = {
  origin: null,
  destination: null,
  departure_date: '',
  ticket_class: 'economy',
  price: '',
  stopovers: '0',
  airline: '',
  valid_until: '',
  is_public: true,
};

function toFormValues(offer: AdminOffer): OfferFormValues {
  return {
    origin: offer.origin,
    destination: offer.destination,
    departure_date: offer.departure_date,
    ticket_class: offer.ticket_class,
    price: offer.price,
    stopovers: String(offer.stopovers),
    airline: offer.airline,
    valid_until: offer.valid_until,
    is_public: offer.is_public,
  };
}

export function AdminOfferNewScreen() {
  return <OfferForm initial={EMPTY} />;
}

export function AdminOfferEditScreen({ route }: NativeStackScreenProps<RootStackParamList, 'AdminOfferEdit'>) {
  const { id } = route.params;
  const offer = useQuery({
    queryKey: ['admin', 'offers', id],
    queryFn: async () => (await api.get<AdminOffer>(`/admin/offers/${id}`)).data,
  });
  if (offer.isPending) {
    return <LoadingState />;
  }
  if (offer.isError) {
    return <ErrorState error={offer.error} onRetry={() => offer.refetch()} />;
  }
  return <OfferForm id={id} initial={toFormValues(offer.data)} />;
}

function OfferForm({ id, initial }: { id?: number; initial: OfferFormValues }) {
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const isCreate = id === undefined;
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, formState } = useForm<OfferFormValues>({
    resolver: zodResolver(offerSchema(isCreate)),
    defaultValues: initial,
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const body = toOfferBody(values);
    try {
      if (isCreate) {
        await api.post('/admin/offers', body);
      } else {
        await api.patch(`/admin/offers/${id}`, body);
      }
      await queryClient.invalidateQueries({ queryKey: ['admin', 'offers'] });
      navigation.navigate('AdminTabs', { screen: 'AdminOffers' });
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS));
    }
  });

  return (
    <Screen maxWidth={760}>
      <Text style={styles.title}>{isCreate ? 'New offer' : 'Edit offer'}</Text>
      <Card>
        <OfferFields control={control} />
        <FormError message={formError} />
        <View style={styles.actions}>
          <Button
            title={isCreate ? 'Create offer' : 'Save changes'}
            onPress={onSubmit}
            loading={formState.isSubmitting}
          />
          <Button
            title="Cancel"
            variant="secondary"
            onPress={() => navigation.navigate('AdminTabs', { screen: 'AdminOffers' })}
          />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
