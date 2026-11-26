import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { api } from '../../api/client';
import { Tour } from '../../api/types';
import { useAuthGate } from '../../auth/gate';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DetailError } from '../../components/DetailLayout';
import { Icon, IconName } from '../../components/Icon';
import { PhotoGallery } from '../../components/PhotoGallery';
import { ReviewsCard } from '../../components/Reviews';
import { RichText } from '../../components/rich/RichText';
import { ColumnResults, SplitView } from '../../components/SplitView';
import { LoadingState } from '../../components/StatusViews';
import { MainTabParamList } from '../../navigation/types';
import { colors, createStyles, font, radius, space, weight } from '../../theme';
import { formatDate, formatPrice } from '../../utils/format';
import { NOT_BOOKABLE, slotsLeftLabel, tourDates, unitPrice } from '../../utils/tours';
import { useTourList } from '../explore/exploreLists';
import { TourCard } from './ToursPage';

type Props = BottomTabScreenProps<MainTabParamList, 'TourDetail'>;

/** Width from which the price card sits beside the details. */
const TWO_COLUMNS = 760;

function useTour(id: string) {
  return useQuery({
    queryKey: ['tours', 'detail', id],
    queryFn: async () => (await api.get<Tour>(`/tours/${id}`)).data,
  });
}

/** The tour at /tours/<id>, beside the tours results. */
export function TourDetailScreen({ navigation, route }: Props) {
  const { id } = route.params;
  const { list, update, results } = useTourList();
  const tour = useTour(id);
  const close = useCallback(() => navigation.navigate('Explore', { tab: 'tours' }), [navigation]);
  return (
    <SplitView
      open
      column={
        <ColumnResults
          query={results}
          render={(item) => (
            <TourCard
              key={item.id}
              tour={item}
              selected={item.id === id}
              onPress={() => navigation.setParams({ id: item.id })}
            />
          )}
        />
      }
      page={list.page}
      count={results.data?.count}
      onPage={(page) => update({ page })}
      title={tour.data?.title ?? 'Tour'}
      backLabel="All tours"
      onClose={close}
      detail={<TourDetailView id={id} />}
    />
  );
}

function TourDetailView({ id }: { id: string }) {
  const requireAuth = useAuthGate();
  const [width, setWidth] = useState(0);
  const tour = useTour(id);

  if (tour.isPending) {
    return <LoadingState />;
  }
  if (tour.isError) {
    return (
      <Card>
        <DetailError
          error={tour.error}
          onRetry={() => tour.refetch()}
          notFound="Tour not found"
          message="It may no longer be offered."
        />
      </Card>
    );
  }

  const data = tour.data;
  const book = () => requireAuth({ screen: 'Main', params: { screen: 'TourBook', params: { id } } });
  const priceCard = <PriceCard tour={data} onBook={book} />;

  const isWide = width >= TWO_COLUMNS;

  return (
    <View style={styles.view} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <PhotoGallery title={data.title} photos={data.photos} />
      <View style={[styles.columns, !isWide && styles.stacked]}>
        <View style={styles.main}>
          <Card>
            <Text style={styles.title}>{data.title}</Text>
            <Fact icon="location-outline" text={data.destination} />
            {data.departure_city ? <Fact icon="navigate-outline" text={`Departs from ${data.departure_city}`} /> : null}
            {data.organiser ? <Fact icon="business-outline" text={`Organised by ${data.organiser}`} /> : null}
            <Fact icon="calendar-outline" text={tourDates(data)} />
            {data.meeting_point ? <Fact icon="flag-outline" text={`Meeting point: ${data.meeting_point}`} /> : null}
            <Text style={styles.summary}>{data.summary}</Text>
            <RichText html={data.description} />
          </Card>
          {!isWide ? priceCard : null}
          <ReviewsCard scope={{ tour: data.id }} />
          {data.included.length || data.not_included.length ? (
            <Card>
              <Lines title="Included" icon="checkmark-circle" color={colors.success} lines={data.included} />
              <Lines title="Not included" icon="close-circle" color={colors.danger} lines={data.not_included} />
            </Card>
          ) : null}
          <Card>
            <Text style={styles.heading}>Cancellation policy</Text>
            <Text style={styles.text}>{data.cancellation_policy}</Text>
            <Text style={styles.strong}>Free to cancel until {formatDate(data.cancellation_deadline)}</Text>
          </Card>
        </View>
        {isWide ? <View style={styles.side}>{priceCard}</View> : null}
      </View>
    </View>
  );
}

function Fact({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.fact}>
      <Icon name={icon} size={18} color={colors.primary} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

function Lines({ title, icon, color, lines }: { title: string; icon: IconName; color: string; lines: string[] }) {
  if (!lines.length) {
    return null;
  }
  return (
    <View style={styles.lines}>
      <Text style={styles.heading}>{title}</Text>
      {lines.map((line, index) => (
        <View key={index} style={styles.fact}>
          <Icon name={icon} size={18} color={color} />
          <Text style={styles.text}>{line}</Text>
        </View>
      ))}
    </View>
  );
}

export function PriceCard({ tour, onBook }: { tour: Tour; onBook: () => void }) {
  return (
    <Card>
      <Text style={styles.heading}>Prices</Text>
      {tour.options.map((option) => (
        <View key={option.id} style={styles.option}>
          <View style={styles.optionText}>
            <Text style={styles.strong}>{option.name}</Text>
            {option.description ? <Text style={styles.muted}>{option.description}</Text> : null}
            {option.units_left !== null ? (
              <Text style={styles.muted}>{option.units_left ? `${option.units_left} left` : 'Sold out'}</Text>
            ) : null}
          </View>
          <Text style={styles.optionPrice}>{unitPrice(option)}</Text>
        </View>
      ))}
      {tour.from_price ? <Text style={styles.text}>From {formatPrice(tour.from_price)} per person</Text> : null}
      {tour.bookable ? (
        <>
          <Text style={styles.text}>
            {slotsLeftLabel(tour.slots_left)} · Book by {formatDate(tour.booking_deadline)}
          </Text>
          <Button title="Book" variant="accent" onPress={onBook} />
        </>
      ) : tour.not_bookable_reason === 'fully_booked' ? (
        <View style={styles.closed}>
          <Icon name="information-circle-outline" size={20} color={colors.warningText} />
          <View style={styles.optionText}>
            <Text style={styles.closedText}>Fully booked</Text>
            <Text style={styles.closedNote}>This tour has no places left.</Text>
          </View>
        </View>
      ) : (
        <View style={styles.closed}>
          <Icon name="information-circle-outline" size={20} color={colors.warningText} />
          <Text style={styles.closedText}>
            {tour.not_bookable_reason ? NOT_BOOKABLE[tour.not_bookable_reason] : NOT_BOOKABLE.closed}
          </Text>
        </View>
      )}
    </Card>
  );
}

const styles = createStyles(() => ({
  view: { gap: space.lg },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: space.lg },
  stacked: { flexDirection: 'column', alignItems: 'stretch' },
  main: { flex: 1, minWidth: 0, gap: space.lg },
  side: { width: 340, gap: space.lg },
  title: { fontSize: font.display, fontWeight: weight.heavy, color: colors.text },
  heading: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  summary: { fontSize: font.heading, color: colors.text },
  text: { fontSize: font.body, color: colors.text, flexShrink: 1 },
  strong: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  lines: { gap: space.sm },
  option: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: space.md,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionText: { flex: 1, minWidth: 0, gap: 2 },
  optionPrice: { fontSize: font.body, fontWeight: weight.bold, color: colors.text, textAlign: 'right' },
  closed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningTint,
  },
  closedText: { color: colors.warningText, fontWeight: weight.semibold, flexShrink: 1 },
  closedNote: { color: colors.warningText, fontSize: font.small },
}));
