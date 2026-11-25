import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Text } from 'react-native';

import { api } from '../../api/client';
import { Tour, User } from '../../api/types';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DetailError } from '../../components/DetailLayout';
import { Screen } from '../../components/Screen';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { AUTH_PATH } from '../../config';
import { MainTabParamList } from '../../navigation/types';
import { colors, createStyles, font, weight } from '../../theme';
import { TourBookForm } from './TourBookForm';

/** The customer's Book tour page, behind the auth gate. */
export function TourBookScreen({ navigation, route }: BottomTabScreenProps<MainTabParamList, 'TourBook'>) {
  const { id } = route.params;
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState<string | null>(null);
  const tour = useQuery({
    queryKey: ['tours', 'detail', id],
    queryFn: async () => (await api.get<Tour>(`/tours/${id}`)).data,
  });
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => (await api.get<User>(`${AUTH_PATH}/me`)).data,
  });

  if (tour.isPending || me.isPending) {
    return <LoadingState />;
  }
  if (tour.isError) {
    return (
      <Screen maxWidth={760}>
        <Card>
          {conflict ? (
            <>
              <Text style={styles.title}>This tour can no longer be booked</Text>
              <Text style={styles.text}>{conflict}</Text>
              <Button title="See other tours" onPress={() => navigation.navigate('Explore')} />
            </>
          ) : (
            <DetailError
              error={tour.error}
              onRetry={() => tour.refetch()}
              notFound="Tour not found"
              message="It may be fully booked or no longer offered."
            />
          )}
        </Card>
      </Screen>
    );
  }
  if (me.isError) {
    return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  }

  return (
    <Screen maxWidth={760}>
      <BackLink label="Tour" onPress={() => navigation.navigate('TourDetail', { id })} />
      <Text style={styles.title}>Book this tour</Text>
      <TourBookForm
        tour={tour.data}
        hasPhone={Boolean(me.data.phone)}
        onBooked={async (booking) => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['tour-bookings'] }),
            queryClient.invalidateQueries({ queryKey: ['tours'] }),
            queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }),
          ]);
          navigation.navigate('Bookings', { tour: booking.id, booked: 'yes' });
        }}
        onConflict={(message) => {
          setConflict(message);
          void tour.refetch();
        }}
      />
    </Screen>
  );
}

const styles = createStyles(() => ({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  text: { fontSize: font.body, color: colors.text },
}));
