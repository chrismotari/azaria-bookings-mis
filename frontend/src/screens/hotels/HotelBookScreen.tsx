import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Text } from 'react-native';

import { api } from '../../api/client';
import { User } from '../../api/types';
import { BackLink } from '../../components/BackLink';
import { Card } from '../../components/Card';
import { DetailError } from '../../components/DetailLayout';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { AUTH_PATH } from '../../config';
import { MainTabParamList } from '../../navigation/types';
import { colors, createStyles, font, weight } from '../../theme';
import { HotelBookForm } from './HotelBookForm';
import { useHotel } from './HotelDetailScreen';
import { Stay, stayFrom, stayParams } from './HotelParts';

/** The customer's Request booking page, behind the auth gate. */
export function HotelBookScreen({ navigation, route }: BottomTabScreenProps<MainTabParamList, 'HotelBook'>) {
  const { id, rooms, ...params } = route.params;
  const queryClient = useQueryClient();
  // Kept here, not in the URL, so changing the dates keeps what was typed.
  const [stay, setStay] = useState<Stay>(() => stayFrom(params));
  const hotel = useHotel(id, stayParams(stay));
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => (await api.get<User>(`${AUTH_PATH}/me`)).data,
  });

  if (hotel.isPending || me.isPending) {
    return <LoadingState />;
  }
  if (hotel.isError) {
    return (
      <Screen maxWidth={760}>
        <Card>
          <DetailError
            error={hotel.error}
            onRetry={() => hotel.refetch()}
            notFound="Hotel not found"
            message="It may no longer be offered."
          />
        </Card>
      </Screen>
    );
  }
  if (me.isError) {
    return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  }

  return (
    <Screen maxWidth={760}>
      <BackLink label="Hotel" onPress={() => navigation.navigate('HotelDetail', { id, ...stayParams(stay) })} />
      <Text style={styles.title}>Request booking</Text>
      <HotelBookForm
        hotel={hotel.data}
        stay={stay}
        onStayChange={setStay}
        initialRates={rooms ? rooms.split(',') : []}
        contact={me.data}
        hasPhone={Boolean(me.data.phone)}
        onBooked={async (booking) => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['hotel-bookings'] }),
            queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }),
          ]);
          navigation.navigate('Bookings', { hotel: booking.id });
        }}
        onConflict={() => void hotel.refetch()}
      />
    </Screen>
  );
}

const styles = createStyles(() => ({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
}));
