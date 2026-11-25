import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Text } from 'react-native';

import { api } from '../../api/client';
import { AdminCustomer, AdminTour } from '../../api/types';
import { BackLink } from '../../components/BackLink';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { AdminTabParamList } from '../../navigation/types';
import { colors, createStyles, font, weight } from '../../theme';
import { TourBookForm } from '../tours/TourBookForm';

/** The Book tour page, filled in by an admin for a customer. */
export function AdminTourBookScreen({ navigation, route }: BottomTabScreenProps<AdminTabParamList, 'AdminTourBook'>) {
  const { id, customer: customerId } = route.params;
  const queryClient = useQueryClient();
  const tour = useQuery({
    queryKey: ['admin', 'tours', 'detail', id],
    queryFn: async () => (await api.get<AdminTour>(`/admin/tours/${id}`)).data,
  });
  const customer = useQuery({
    queryKey: ['admin', 'users', customerId],
    queryFn: async () => (await api.get<AdminCustomer>(`/admin/users/${customerId}`)).data,
  });

  if (tour.isPending || customer.isPending) {
    return <LoadingState />;
  }
  if (tour.isError || customer.isError) {
    return (
      <ErrorState
        error={tour.error ?? customer.error}
        onRetry={() => (tour.isError ? tour.refetch() : customer.refetch())}
      />
    );
  }

  return (
    <Screen maxWidth={760}>
      <BackLink label="Tour" onPress={() => navigation.navigate('AdminTours', { id })} />
      <Text style={styles.title}>Book for {customer.data.full_name}</Text>
      <Text style={styles.muted}>
        {customer.data.email}
        {customer.data.phone ? ` · ${customer.data.phone}` : ''}
      </Text>
      <TourBookForm
        tour={{ ...tour.data, options: tour.data.options.filter((option) => option.is_active) }}
        hasPhone={Boolean(customer.data.phone)}
        customer={customer.data}
        onBooked={async (booking) => {
          await queryClient.invalidateQueries({ queryKey: ['admin'] });
          navigation.navigate('AdminTours', { id, booking: booking.id });
        }}
        onConflict={() => tour.refetch()}
      />
    </Screen>
  );
}

const styles = createStyles(() => ({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  muted: { fontSize: font.body, color: colors.muted },
}));
