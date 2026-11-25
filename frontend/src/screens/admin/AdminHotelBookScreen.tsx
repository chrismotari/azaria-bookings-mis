import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Text } from 'react-native';

import { api } from '../../api/client';
import { AdminCustomer } from '../../api/types';
import { BackLink } from '../../components/BackLink';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { AdminTabParamList } from '../../navigation/types';
import { colors, createStyles, font, weight } from '../../theme';
import { HotelBookForm } from '../hotels/HotelBookForm';
import { useHotel } from '../hotels/HotelDetailScreen';
import { EMPTY_STAY, Stay, stayParams } from '../hotels/HotelParts';

/** The Request booking page, filled in by an admin for a customer. */
export function AdminHotelBookScreen({ navigation, route }: BottomTabScreenProps<AdminTabParamList, 'AdminHotelBook'>) {
  const { id, customer: customerId } = route.params;
  const queryClient = useQueryClient();
  const [stay, setStay] = useState<Stay>(EMPTY_STAY);
  const hotel = useHotel(id, stayParams(stay));
  const customer = useQuery({
    queryKey: ['admin', 'users', customerId],
    queryFn: async () => (await api.get<AdminCustomer>(`/admin/users/${customerId}`)).data,
  });

  if (hotel.isPending || customer.isPending) {
    return <LoadingState />;
  }
  if (hotel.isError || customer.isError) {
    return (
      <ErrorState
        error={hotel.error ?? customer.error}
        onRetry={() => (hotel.isError ? hotel.refetch() : customer.refetch())}
      />
    );
  }

  return (
    <Screen maxWidth={760}>
      <BackLink label="Hotel bookings" onPress={() => navigation.navigate('AdminHotels')} />
      <Text style={styles.title}>Book for {customer.data.full_name}</Text>
      <Text style={styles.muted}>
        {customer.data.email}
        {customer.data.phone ? ` · ${customer.data.phone}` : ''}
      </Text>
      <HotelBookForm
        hotel={hotel.data}
        stay={stay}
        onStayChange={setStay}
        initialRates={[]}
        contact={customer.data}
        hasPhone={Boolean(customer.data.phone)}
        customer={customer.data}
        onBooked={async (booking) => {
          await queryClient.invalidateQueries({ queryKey: ['admin'] });
          navigation.navigate('AdminHotels', { id: booking.id, status: 'requested' });
        }}
        onConflict={() => void hotel.refetch()}
      />
    </Screen>
  );
}

const styles = createStyles(() => ({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  muted: { fontSize: font.body, color: colors.muted },
}));
