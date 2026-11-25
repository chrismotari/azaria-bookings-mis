import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { api } from '../../api/client';
import { ExploreCards, Module } from '../../api/types';
import { Button } from '../../components/Button';
import { FlightCard } from '../../components/FlightCard';
import { colors, createStyles, font, space, useIsWide, weight } from '../../theme';
import { HotelCard } from '../hotels/HotelParts';
import { TourCard } from '../tours/ToursPage';

const PHONE_CARD_WIDTH = 280;

export function useExplore() {
  return useQuery({
    queryKey: ['explore'],
    queryFn: async () => (await api.get<ExploreCards>('/explore')).data,
  });
}

/** How many cards a module has to show on Explore. */
export function cardCount(cards: ExploreCards | undefined, module: Module): number {
  return cards?.[module]?.length ?? 0;
}

/** Cards in three columns on wide screens; on phones one row scrolled sideways within itself. */
function CardRow({ children }: { children: ReactNode[] }) {
  const isWide = useIsWide();
  const [width, setWidth] = useState(0);
  if (!isWide) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.strip}>
        {children.map((child, index) => (
          <View key={index} style={styles.stripCard}>
            {child}
          </View>
        ))}
      </ScrollView>
    );
  }
  const cardWidth = width ? (width - space.lg * 2) / 3 : undefined;
  return (
    <View style={styles.grid} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {children.map((child, index) => (
        <View key={index} style={cardWidth ? { width: cardWidth } : styles.third}>
          {child}
        </View>
      ))}
    </View>
  );
}

/** The module's Explore cards, each opening the item's detail. */
export function ModuleCards({ module, cards }: { module: Module; cards: ExploreCards }) {
  const navigation = useNavigation();
  const items =
    module === 'flights'
      ? (cards.flights ?? []).map((offer) => (
          <FlightCard
            key={offer.id}
            offer={offer}
            onPress={() => navigation.navigate('Main', { screen: 'Explore', params: { id: offer.id } })}
          />
        ))
      : module === 'tours'
        ? (cards.tours ?? []).map((tour) => (
            <TourCard
              key={tour.id}
              tour={tour}
              onPress={() => navigation.navigate('Main', { screen: 'TourDetail', params: { id: tour.id } })}
            />
          ))
        : (cards.hotels ?? []).map((hotel) => (
            <HotelCard
              key={hotel.id}
              hotel={hotel}
              nights={0}
              onPress={() => navigation.navigate('Main', { screen: 'HotelDetail', params: { id: hotel.id } })}
            />
          ));
  return <CardRow>{items}</CardRow>;
}

/** A titled section of cards, with "See all" when given. */
export function CardSection({
  title,
  module,
  cards,
  onSeeAll,
}: {
  title: string;
  module: Module;
  cards: ExploreCards;
  onSeeAll?: () => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {onSeeAll ? <Button title="See all" variant="link" onPress={onSeeAll} /> : null}
      </View>
      <ModuleCards module={module} cards={cards} />
    </View>
  );
}

/** A one-module agency's "Featured" row above its results; nothing while loading, on error or when empty. */
export function FeaturedRow({ module }: { module: Module }) {
  const explore = useExplore();
  if (!explore.data || cardCount(explore.data, module) === 0) {
    return null;
  }
  return <CardSection title="Featured" module={module} cards={explore.data} />;
}

const styles = createStyles(() => ({
  section: { gap: space.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  third: { width: '31%' },
  strip: { gap: space.md, paddingBottom: space.sm },
  stripCard: { width: PHONE_CARD_WIDTH },
}));
