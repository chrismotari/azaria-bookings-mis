import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { api } from '../../api/client';
import { Tour } from '../../api/types';
import { useAuthGate } from '../../auth/gate';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DetailError } from '../../components/DetailLayout';
import { Dialog } from '../../components/Dialog';
import { Icon, IconName } from '../../components/Icon';
import { PressState } from '../../components/pressState';
import { RichText } from '../../components/rich/RichText';
import { Screen } from '../../components/Screen';
import { LoadingState } from '../../components/StatusViews';
import { MainTabParamList } from '../../navigation/types';
import { colors, createStyles, font, radius, space, useIsWide, weight } from '../../theme';
import { formatDate, formatPrice } from '../../utils/format';
import { NOT_BOOKABLE, slotsLeftLabel, tourDates, unitPrice } from '../../utils/tours';
import { TourCover } from './ToursPage';

type Props = BottomTabScreenProps<MainTabParamList, 'TourDetail'>;

export function TourDetailScreen({ navigation, route }: Props) {
  const { id } = route.params;
  const isWide = useIsWide();
  const requireAuth = useAuthGate();
  const tour = useQuery({
    queryKey: ['tours', 'detail', id],
    queryFn: async () => (await api.get<Tour>(`/tours/${id}`)).data,
  });
  const back = <BackLink label="All tours" onPress={() => navigation.navigate('Explore')} />;

  if (tour.isPending) {
    return <LoadingState />;
  }
  if (tour.isError) {
    return (
      <Screen maxWidth={900}>
        {back}
        <Card>
          <DetailError
            error={tour.error}
            onRetry={() => tour.refetch()}
            notFound="Tour not found"
            message="It may be fully booked or no longer offered."
          />
        </Card>
      </Screen>
    );
  }

  const data = tour.data;
  const book = () => requireAuth({ screen: 'Main', params: { screen: 'TourBook', params: { id } } });
  const priceCard = <PriceCard tour={data} onBook={book} />;

  return (
    <Screen maxWidth={1100}>
      {back}
      <Gallery tour={data} />
      <View style={[styles.columns, !isWide && styles.stacked]}>
        <View style={styles.main}>
          <Card>
            <Text style={styles.title}>{data.title}</Text>
            <Fact icon="location-outline" text={data.destination} />
            <Fact icon="calendar-outline" text={tourDates(data)} />
            {data.meeting_point ? <Fact icon="flag-outline" text={`Meeting point: ${data.meeting_point}`} /> : null}
            <Text style={styles.summary}>{data.summary}</Text>
            <RichText html={data.description} />
          </Card>
          {!isWide ? priceCard : null}
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
    </Screen>
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

function Gallery({ tour }: { tour: Tour }) {
  const isWide = useIsWide();
  const [open, setOpen] = useState<string | null>(null);
  const [cover, ...rest] = tour.photos;
  if (!cover) {
    return <TourCover url={null} height={isWide ? 280 : 200} />;
  }
  const photo = (url: string, label: string, style: object) => (
    <Pressable
      key={url}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => setOpen(url)}
      style={({ hovered }: PressState) => [style, hovered && styles.photoHovered]}
    >
      <Image source={{ uri: url }} style={styles.image} resizeMode="cover" />
    </Pressable>
  );
  return (
    <View style={styles.gallery}>
      {photo(cover.url, 'Open the cover photo', [styles.coverPhoto, { height: isWide ? 360 : 220 }])}
      {rest.length ? (
        <View style={styles.thumbs}>
          {rest.map((item, index) => photo(item.url, `Open photo ${index + 2}`, styles.thumb))}
        </View>
      ) : null}
      {open ? (
        <Dialog open title={tour.title} size="wide" onClose={() => setOpen(null)} footer={null}>
          <Image source={{ uri: open }} style={styles.large} resizeMode="contain" accessibilityLabel="Photo" />
        </Dialog>
      ) : null}
    </View>
  );
}

function PriceCard({ tour, onBook }: { tour: Tour; onBook: () => void }) {
  return (
    <Card>
      <Text style={styles.heading}>Prices</Text>
      {tour.options.map((option) => (
        <View key={option.id} style={styles.option}>
          <View style={styles.optionText}>
            <Text style={styles.strong}>{option.name}</Text>
            {option.description ? <Text style={styles.muted}>{option.description}</Text> : null}
            {option.units_left !== null ? (
              <Text style={styles.muted}>{option.units_left ? `${option.units_left} left` : 'None left'}</Text>
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
  gallery: { gap: space.sm },
  coverPhoto: { width: '100%', borderRadius: radius.lg, overflow: 'hidden' },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  thumb: { width: 96, height: 72, borderRadius: radius.md, overflow: 'hidden' },
  photoHovered: { opacity: 0.85 },
  image: { width: '100%', height: '100%' },
  large: { width: '100%', height: 520 },
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
}));
