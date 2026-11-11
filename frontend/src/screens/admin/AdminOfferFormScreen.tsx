import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { StyleSheet, Text } from 'react-native';

import { api } from '../../api/client';
import { applyServerErrors } from '../../api/errors';
import { AdminOffer } from '../../api/types';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { FormError } from '../../components/Field';
import { FormFooter } from '../../components/FormSection';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { colors, font, weight } from '../../theme';
import { OfferFields } from './OfferFields';
import {
  OfferFormValues,
  offerDefaults,
  offerSchema,
  toItineraryFormValues,
  toOfferBody,
  tripFormValues,
} from './offerSchema';

const FIELDS = [
  'trip_type',
  'segments',
  'ticket_class',
  'price',
  'airline',
  'valid_until',
  'is_public',
  'checked_bags',
  'checked_bag_kg',
  'cabin_bag_kg',
  'refund_policy',
  'change_policy',
] as const;

function toFormValues(offer: AdminOffer): OfferFormValues {
  return offerDefaults({
    trip_type: offer.trip_type,
    segments: toItineraryFormValues(offer.itinerary),
    ticket_class: offer.ticket_class,
    price: offer.price,
    airline: offer.airline,
    valid_until: offer.valid_until,
    is_public: offer.is_public,
    ...tripFormValues(offer),
    refund_policy: offer.refund_policy,
    change_policy: offer.change_policy,
  });
}

export function AdminOfferNewScreen() {
  const navigation = useNavigation();
  const backToOffers = () => navigation.navigate('AdminTabs', { screen: 'AdminOffers' });
  return (
    <Screen maxWidth={760}>
      <BackLink label="Offers" onPress={backToOffers} />
      <Text style={styles.title}>New offer</Text>
      <OfferForm initial={offerDefaults()} onDone={backToOffers} />
    </Screen>
  );
}

/** onDone: called after saving or cancelling. */
export function AdminOfferEditView({ id, onDone }: { id: string; onDone: () => void }) {
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
  return <OfferForm id={id} initial={toFormValues(offer.data)} onDone={onDone} />;
}

type FormProps = { id?: string; initial: OfferFormValues; onDone: () => void };

function OfferForm({ id, initial, onDone }: FormProps) {
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
      onDone();
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS));
    }
  });

  return (
    <>
      <OfferFields control={control} />
      <FormError message={formError} />
      <FormFooter>
        <Button title="Cancel" variant="secondary" onPress={onDone} />
        <Button
          title={isCreate ? 'Create offer' : 'Save changes'}
          onPress={onSubmit}
          loading={formState.isSubmitting}
        />
      </FormFooter>
    </>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
});
