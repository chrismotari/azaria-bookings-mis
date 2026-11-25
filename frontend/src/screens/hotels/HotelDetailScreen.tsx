import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { api } from '../../api/client';
import { Hotel, HotelRate, HotelRoomType } from '../../api/types';
import { useAuthGate } from '../../auth/gate';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DetailError } from '../../components/DetailLayout';
import { FormError } from '../../components/Field';
import { Icon, IconName } from '../../components/Icon';
import { PhotoGallery } from '../../components/PhotoGallery';
import { PriceTag } from '../../components/PriceTag';
import { ReviewsCard } from '../../components/Reviews';
import { RichText } from '../../components/rich/RichText';
import { Screen } from '../../components/Screen';
import { SelectField } from '../../components/SelectField';
import { LoadingState } from '../../components/StatusViews';
import { HotelStay, MainTabParamList } from '../../navigation/types';
import { colors, createStyles, font, radius, space, useIsWide, weight } from '../../theme';
import { formatPrice } from '../../utils/format';
import {
  adultsPriced,
  fitsGuests,
  guestsLabel,
  MAX_ROOMS,
  nightsLabel,
  roomStayPrice,
  timeLabel,
} from '../../utils/hotels';
import { Stay, StayErrors, StayFields, StarRating, stayFrom, stayParams, validateStay } from './HotelParts';

type Props = BottomTabScreenProps<MainTabParamList, 'HotelDetail'>;

const ROOM_COUNTS = Array.from({ length: MAX_ROOMS + 1 }, (_, index) => ({
  value: String(index),
  label: String(index),
}));

/** The hotel at /hotels/<id>, with prices for the stay in its URL. */
export function useHotel(id: string, stay: HotelStay) {
  return useQuery({
    queryKey: ['hotels', 'detail', id, stay],
    queryFn: async () => (await api.get<Hotel>(`/hotels/${id}`, { params: stay })).data,
    placeholderData: keepPreviousData,
  });
}

export function HotelDetailScreen({ navigation, route }: Props) {
  const { id, ...stay } = route.params;
  const isWide = useIsWide();
  const requireAuth = useAuthGate();
  const [draft, setDraft] = useState<Stay>(() => stayFrom(stay));
  const [errors, setErrors] = useState<StayErrors>({});
  const [picked, setPicked] = useState<Record<string, number>>({});
  const hotel = useHotel(id, stayParams(stayFrom(stay)));
  const back = <BackLink label="All hotels" onPress={() => navigation.navigate('Explore')} />;

  if (hotel.isPending) {
    return <LoadingState />;
  }
  if (hotel.isError) {
    return (
      <Screen maxWidth={900}>
        {back}
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

  const data = hotel.data;
  const adults = stay.adults ? Number(stay.adults) : undefined;
  const children = stay.children ? Number(stay.children) : undefined;
  const applyStay = () => {
    const found = validateStay(draft);
    setErrors(found);
    if (Object.keys(found).length === 0) {
      const cleared = { check_in: undefined, check_out: undefined, adults: undefined, children: undefined };
      navigation.setParams({ ...cleared, ...stayParams(draft) });
    }
  };
  const rates = data.room_types.flatMap((roomType) => roomType.rates.map((rate) => ({ roomType, rate })));
  const chosen = rates.filter(({ rate }) => (picked[rate.id] ?? 0) > 0 && rate.available);
  const roomCount = chosen.reduce((sum, { rate }) => sum + picked[rate.id], 0);
  const total = chosen.reduce(
    (sum, { rate }) => sum + (roomStayPrice(rate, adultsPriced(rate, adults)) ?? 0) * picked[rate.id],
    0,
  );
  const nights = rates.find(({ rate }) => rate.nights)?.rate.nights ?? 0;
  const request = () =>
    requireAuth({
      screen: 'Main',
      params: {
        screen: 'HotelBook',
        params: {
          id,
          ...stay,
          rooms: chosen.flatMap(({ rate }) => Array.from({ length: picked[rate.id] }, () => rate.id)).join(','),
        },
      },
    });

  const summary = (
    <Card>
      <Text style={styles.heading}>Your rooms</Text>
      {chosen.length ? (
        chosen.map(({ roomType, rate }) => (
          <View key={rate.id} style={styles.between}>
            <Text style={[styles.text, styles.shrink]}>
              {picked[rate.id]} × {roomType.name}, {rate.name}
            </Text>
            <Text style={styles.text}>
              {formatPrice((roomStayPrice(rate, adultsPriced(rate, adults)) ?? 0) * picked[rate.id])}
            </Text>
          </View>
        ))
      ) : (
        <Text style={styles.muted}>
          {nights ? 'Choose rooms in the table.' : 'Choose dates to see prices and pick rooms.'}
        </Text>
      )}
      {nights ? <Text style={styles.muted}>{nightsLabel(nights)}</Text> : null}
      <View style={styles.between}>
        <Text style={styles.heading}>Total</Text>
        <PriceTag amount={total} size="large" />
      </View>
      <FormError message={roomCount > MAX_ROOMS ? `Choose at most ${MAX_ROOMS} rooms.` : null} />
      <Button
        title="Request booking"
        variant="accent"
        onPress={request}
        disabled={!roomCount || roomCount > MAX_ROOMS}
      />
      <Text style={styles.muted}>The agency will confirm availability with the hotel.</Text>
    </Card>
  );

  return (
    <Screen maxWidth={1100}>
      {back}
      <PhotoGallery title={data.name} photos={data.photos} />
      <Card>
        <Text style={styles.title}>{data.name}</Text>
        <StarRating stars={data.star_rating} size={18} />
        <Fact icon="location-outline" text={`${data.address}, ${data.destination}`} />
        <Fact
          icon="time-outline"
          text={`Check-in from ${timeLabel(data.check_in_time)} · Check-out by ${timeLabel(data.check_out_time)}`}
        />
        <Text style={styles.summary}>{data.summary}</Text>
        <RichText html={data.description} />
        {data.amenities.length ? (
          <View style={styles.amenities}>
            {data.amenities.map((amenity, index) => (
              <View key={index} style={styles.amenity}>
                <Icon name="checkmark-circle" size={18} color={colors.success} />
                <Text style={styles.text}>{amenity}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>
      <ReviewsCard scope={{ hotel: data.id }} />
      <Card>
        <Text style={styles.heading}>Your stay</Text>
        <StayFields value={draft} onChange={setDraft} errors={errors} />
        <View style={styles.start}>
          <Button title={nights ? 'Update prices' : 'Show prices'} icon="search" onPress={applyStay} />
        </View>
      </Card>
      <View style={[styles.columns, !isWide && styles.stacked]}>
        <View style={styles.main}>
          <Card>
            <Text style={styles.heading}>Rooms</Text>
            {data.room_types.length === 0 ? (
              <Text style={styles.muted}>No rooms are offered right now.</Text>
            ) : isWide ? (
              <RoomTable
                roomTypes={data.room_types}
                adults={adults}
                childrenCount={children}
                picked={picked}
                onPick={(rate, count) => setPicked({ ...picked, [rate]: count })}
              />
            ) : (
              data.room_types.map((roomType) => (
                <View key={roomType.id} style={styles.typeCard}>
                  <RoomTypeName roomType={roomType} />
                  {roomType.rates.map((rate) => (
                    <View key={rate.id} style={[styles.phoneRate, !fitsGuests(rate, adults, children) && styles.dim]}>
                      <View style={styles.between}>
                        <Text style={styles.strong}>{rate.name}</Text>
                        <Sleeps rate={rate} />
                      </View>
                      <RatePrice rate={rate} adults={adults} />
                      <Inclusions rate={rate} />
                      <RoomPicker
                        roomType={roomType}
                        rate={rate}
                        value={picked[rate.id] ?? 0}
                        onChange={(count) => setPicked({ ...picked, [rate.id]: count })}
                      />
                    </View>
                  ))}
                </View>
              ))
            )}
            {adults || children ? (
              <Text style={styles.muted}>
                Rates that cannot hold {guestsLabel(adults ?? 1, children ?? 0)} in one room are dimmed.
              </Text>
            ) : null}
          </Card>
          <Card>
            <Text style={styles.heading}>Cancellation policy</Text>
            <Text style={styles.text}>{data.cancellation_policy}</Text>
          </Card>
        </View>
        <View style={isWide ? styles.side : undefined}>{summary}</View>
      </View>
    </Screen>
  );
}

const COLUMNS = { type: 2.2, sleeps: 1, price: 1.6, included: 2, rooms: 0.9 };

function RoomTable({
  roomTypes,
  adults,
  childrenCount,
  picked,
  onPick,
}: {
  roomTypes: HotelRoomType[];
  adults?: number;
  childrenCount?: number;
  picked: Record<string, number>;
  onPick: (rate: string, count: number) => void;
}) {
  return (
    <View style={styles.table} accessibilityRole="table">
      <View style={[styles.tableRow, styles.tableHead]} accessibilityRole="row">
        {(['Room type', 'Sleeps', 'Price', "What's included", 'Rooms'] as const).map((label, index) => (
          <Text
            key={label}
            style={[styles.headCell, { flex: Object.values(COLUMNS)[index] }]}
            accessibilityRole="columnheader"
          >
            {label}
          </Text>
        ))}
      </View>
      {roomTypes.map((roomType) => (
        <View key={roomType.id} style={styles.tableRow}>
          <View style={[styles.cell, { flex: COLUMNS.type }]}>
            <RoomTypeName roomType={roomType} />
          </View>
          <View style={styles.rates}>
            {roomType.rates.map((rate, index) => (
              <View
                key={rate.id}
                style={[
                  styles.rateRow,
                  index > 0 && styles.rateDivider,
                  !fitsGuests(rate, adults, childrenCount) && styles.dim,
                ]}
                accessibilityRole="row"
              >
                <View style={[styles.cell, { flex: COLUMNS.sleeps }]}>
                  <Text style={styles.strong}>{rate.name}</Text>
                  <Sleeps rate={rate} />
                </View>
                <View style={[styles.cell, { flex: COLUMNS.price }]}>
                  <RatePrice rate={rate} adults={adults} />
                </View>
                <View style={[styles.cell, { flex: COLUMNS.included }]}>
                  <Inclusions rate={rate} />
                </View>
                <View style={[styles.cell, { flex: COLUMNS.rooms }]}>
                  <RoomPicker
                    roomType={roomType}
                    rate={rate}
                    value={picked[rate.id] ?? 0}
                    onChange={(count) => onPick(rate.id, count)}
                  />
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function RoomTypeName({ roomType }: { roomType: HotelRoomType }) {
  return (
    <View style={styles.typeName}>
      <Text style={styles.heading}>{roomType.name}</Text>
      {roomType.description ? <Text style={styles.muted}>{roomType.description}</Text> : null}
    </View>
  );
}

/** Person icons for the rate's adults, and smaller ones for its children. */
export function Sleeps({ rate }: { rate: Pick<HotelRate, 'max_adults' | 'max_children'> }) {
  return (
    <View
      style={styles.sleeps}
      accessible
      accessibilityLabel={`Sleeps ${guestsLabel(rate.max_adults, rate.max_children)}`}
    >
      {Array.from({ length: rate.max_adults }, (_, index) => (
        <Icon key={`a${index}`} name="person" size={18} color={colors.text} />
      ))}
      {Array.from({ length: rate.max_children }, (_, index) => (
        <Icon key={`c${index}`} name="person" size={13} color={colors.muted} />
      ))}
    </View>
  );
}

function RatePrice({ rate, adults }: { rate: HotelRate; adults?: number }) {
  if (rate.available === null) {
    return <Text style={styles.muted}>Choose dates to see prices</Text>;
  }
  if (!rate.available || rate.nights === null) {
    return <Text style={styles.unavailable}>Not available for these dates</Text>;
  }
  const priced = adultsPriced(rate, adults);
  const charge = Number(rate.per_adult_per_night);
  return (
    <View style={styles.priceCell}>
      <Text style={styles.price}>{formatPrice(roomStayPrice(rate, priced) ?? 0)}</Text>
      <Text style={styles.muted}>
        {nightsLabel(rate.nights)}, {guestsLabel(priced, 0)}
      </Text>
      {charge > 0 ? <Text style={styles.muted}>+ {formatPrice(charge)} per adult per night</Text> : null}
    </View>
  );
}

function Inclusions({ rate }: { rate: HotelRate }) {
  if (!rate.inclusions.length) {
    return null;
  }
  return (
    <View style={styles.inclusions}>
      {rate.inclusions.map((line, index) => (
        <View key={index} style={styles.inclusion}>
          <Icon name="checkmark" size={16} color={colors.success} />
          <Text style={[styles.small, styles.shrink]}>{line}</Text>
        </View>
      ))}
    </View>
  );
}

function RoomPicker({
  roomType,
  rate,
  value,
  onChange,
}: {
  roomType: HotelRoomType;
  rate: HotelRate;
  value: number;
  onChange: (count: number) => void;
}) {
  if (!rate.available) {
    return <Text style={styles.muted}>—</Text>;
  }
  return (
    <SelectField
      label="Rooms"
      accessibilityLabel={`Rooms: ${roomType.name}, ${rate.name}`}
      options={ROOM_COUNTS}
      value={String(value)}
      onChange={(count) => onChange(Number(count))}
    />
  );
}

function Fact({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.amenity}>
      <Icon name={icon} size={18} color={colors.primary} />
      <Text style={[styles.text, styles.shrink]}>{text}</Text>
    </View>
  );
}

const styles = createStyles(() => ({
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: space.lg },
  stacked: { flexDirection: 'column', alignItems: 'stretch' },
  main: { flex: 1, minWidth: 0, gap: space.lg },
  side: { width: 300 },
  title: { fontSize: font.display, fontWeight: weight.heavy, color: colors.text },
  heading: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  summary: { fontSize: font.heading, color: colors.text },
  text: { fontSize: font.body, color: colors.text },
  small: { fontSize: font.small, color: colors.text },
  strong: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
  unavailable: { fontSize: font.small, color: colors.dangerText, fontWeight: weight.semibold },
  price: { fontSize: font.heading, fontWeight: weight.heavy, color: colors.text },
  shrink: { flexShrink: 1, minWidth: 0 },
  start: { alignSelf: 'flex-start' },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  amenities: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  amenity: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  table: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  tableRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border },
  tableHead: { backgroundColor: colors.primaryTint, borderTopWidth: 0 },
  headCell: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    fontSize: font.small,
    fontWeight: weight.bold,
    color: colors.text,
  },
  cell: { padding: space.md, gap: space.xs, minWidth: 0 },
  typeName: { gap: space.xs },
  rates: {
    flex: COLUMNS.sleeps + COLUMNS.price + COLUMNS.included + COLUMNS.rooms,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  rateRow: { flexDirection: 'row' },
  rateDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  dim: { opacity: 0.45 },
  sleeps: { flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap' },
  priceCell: { gap: 2 },
  inclusions: { gap: space.xs },
  inclusion: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs },
  typeCard: { gap: space.sm, paddingVertical: space.md, borderTopWidth: 1, borderTopColor: colors.border },
  phoneRate: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
}));
