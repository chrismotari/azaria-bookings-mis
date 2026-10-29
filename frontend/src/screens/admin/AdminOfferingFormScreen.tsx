import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigation } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { applyServerErrors } from '../../api/errors';
import { AdminOffering } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FormError } from '../../components/Field';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { RootStackParamList } from '../../navigation/types';
import { colors } from '../../theme';
import { OfferingFields } from './OfferingFields';
import { OfferingFormValues, offeringSchema, toOfferingBody } from './offeringSchema';

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

const EMPTY: OfferingFormValues = {
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

function toFormValues(offering: AdminOffering): OfferingFormValues {
  return {
    origin: offering.origin,
    destination: offering.destination,
    departure_date: offering.departure_date,
    ticket_class: offering.ticket_class,
    price: offering.price,
    stopovers: String(offering.stopovers),
    airline: offering.airline,
    valid_until: offering.valid_until,
    is_public: offering.is_public,
  };
}

export function AdminOfferingNewScreen() {
  return <OfferingForm initial={EMPTY} />;
}

export function AdminOfferingEditScreen({ route }: NativeStackScreenProps<RootStackParamList, 'AdminOfferingEdit'>) {
  const { id } = route.params;
  const offering = useQuery({
    queryKey: ['admin', 'offerings', id],
    queryFn: async () => (await api.get<AdminOffering>(`/admin/offerings/${id}`)).data,
  });
  if (offering.isPending) {
    return <LoadingState />;
  }
  if (offering.isError) {
    return <ErrorState error={offering.error} onRetry={() => offering.refetch()} />;
  }
  return <OfferingForm id={id} initial={toFormValues(offering.data)} />;
}

function OfferingForm({ id, initial }: { id?: number; initial: OfferingFormValues }) {
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const isCreate = id === undefined;
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, formState } = useForm<OfferingFormValues>({
    resolver: zodResolver(offeringSchema(isCreate)),
    defaultValues: initial,
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const body = toOfferingBody(values);
    try {
      if (isCreate) {
        await api.post('/admin/offerings', body);
      } else {
        await api.patch(`/admin/offerings/${id}`, body);
      }
      await queryClient.invalidateQueries({ queryKey: ['admin', 'offerings'] });
      navigation.navigate('AdminTabs', { screen: 'AdminOfferings' });
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS));
    }
  });

  return (
    <Screen maxWidth={760}>
      <Text style={styles.title}>{isCreate ? 'New offering' : 'Edit offering'}</Text>
      <Card>
        <OfferingFields control={control} />
        <FormError message={formError} />
        <View style={styles.actions}>
          <Button
            title={isCreate ? 'Create offering' : 'Save changes'}
            onPress={onSubmit}
            loading={formState.isSubmitting}
          />
          <Button
            title="Cancel"
            variant="secondary"
            onPress={() => navigation.navigate('AdminTabs', { screen: 'AdminOfferings' })}
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
