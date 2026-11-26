import { ComponentRef, ReactNode, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { Airline, Airport, Hotel, HotelRoomType, Offer, Segment, Tour } from '../../api/types';
import { AirlineBadge } from '../../components/AirlineBadge';
import { BookingProgress } from '../../components/BookingProgress';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Column, Columns, LinkRow, MonthChart, SectionTitle, Tile, TileGrid } from '../../components/Dashboard';
import { FlightCard } from '../../components/FlightCard';
import { Icon, IconName } from '../../components/Icon';
import { CardFact, CardPrice } from '../../components/ItemCard';
import { DirectionDetails } from '../../components/Itinerary';
import { PriceTag } from '../../components/PriceTag';
import { FlightServiceRating } from '../../components/Reviews';
import { RouteLine } from '../../components/RouteLine';
import { StatusChip } from '../../components/StatusChip';
import { TENANT_BASE_DOMAIN } from '../../config';
import { colors, createStyles, font, radius, shadowDialog, space, useIsWide, weight } from '../../theme';
import { formatDate, formatPrice } from '../../utils/format';
import { ExploreHero } from '../explore/ExploreAll';
import { RoomTable } from '../hotels/HotelDetailScreen';
import { HotelCard, StarRating } from '../hotels/HotelParts';
import { PriceCard } from '../tours/TourDetailScreen';
import { TourCard } from '../tours/ToursPage';

const noop = () => {};

/** An ISO date this many days from today. */
function daysFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A landscape drawn in the theme's colours, as an image address for the sample cards (no image files). */
function scene(kind: 'savanna' | 'island' | 'beach'): string {
  const sky = { savanna: colors.warningTint, island: colors.primaryTint, beach: colors.infoTint }[kind];
  const land =
    kind === 'savanna'
      ? `<path d="M0 150 Q100 120 200 140 T400 130 V200 H0Z" fill="${colors.tertiary}" opacity="0.55"/>
         <path d="M0 170 Q120 150 240 165 T400 160 V200 H0Z" fill="${colors.tertiary}"/>
         <rect x="292" y="112" width="5" height="44" fill="${colors.dark}"/>
         <ellipse cx="294" cy="110" rx="38" ry="9" fill="${colors.dark}"/>
         <ellipse cx="294" cy="102" rx="24" ry="6" fill="${colors.dark}"/>`
      : kind === 'island'
        ? `<rect y="140" width="400" height="60" fill="${colors.primary}" opacity="0.75"/>
           <path d="M40 142 Q120 105 210 142Z" fill="${colors.tertiary}"/>
           <path d="M285 150 L325 150 L318 160 L292 160Z" fill="${colors.dark}"/>
           <path d="M305 148 L305 104 L330 146Z" fill="${colors.surface}"/>`
        : `<rect y="128" width="400" height="40" fill="${colors.infoText}" opacity="0.55"/>
           <path d="M0 158 Q200 140 400 160 V200 H0Z" fill="${colors.accent}" opacity="0.45"/>
           <path d="M84 168 Q80 130 96 96" stroke="${colors.dark}" stroke-width="5" fill="none"/>
           <path d="M96 96 q-30 -4 -44 12 M96 96 q28 -10 44 6 M96 96 q-8 -22 -30 -26 M96 96 q14 -20 36 -18"
             stroke="${colors.tertiary}" stroke-width="7" fill="none" stroke-linecap="round"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice">
    <rect width="400" height="200" fill="${sky}"/><circle cx="330" cy="62" r="26" fill="${colors.accent}"/>${land}</svg>`;
  // React Native Web encodes the markup itself, and only on one line.
  return `data:image/svg+xml;utf8,${svg.replace(/\s*\n\s*/g, ' ')}`;
}

const airport = (code: string, name: string, city: string, country: string, country_code: string): Airport => ({
  id: code,
  code,
  name,
  city,
  country,
  country_code,
});

const NBO = airport('NBO', 'Jomo Kenyatta International', 'Nairobi', 'Kenya', 'KE');
const DXB = airport('DXB', 'Dubai International', 'Dubai', 'United Arab Emirates', 'AE');
const AIRLINE: Airline = { id: 'kq', iata_code: 'KQ', name: 'Kenya Airways', logo_url: null };

function sampleOffer(): Offer {
  const date = daysFromNow(24);
  const segment: Segment = {
    airline: AIRLINE,
    flight_number: '310',
    operating_airline: null,
    origin: NBO,
    destination: DXB,
    departure_date: date,
    departure_time: '09:40',
    arrival_date: date,
    arrival_time: '15:35',
  };
  return {
    id: 'offer',
    trip_type: 'one_way',
    return_date: null,
    checked_bags: 1,
    checked_bag_kg: 23,
    cabin_bag_kg: 7,
    refund_policy: 'with_fee',
    change_policy: 'with_fee',
    itinerary: { outbound: { segments: [segment], connections: [], stop_count: 0 }, return: null },
    origin: NBO,
    destination: DXB,
    departure_date: date,
    ticket_class: 'economy',
    price: '420.00',
    airline: AIRLINE,
    valid_until: daysFromNow(10),
    is_bookable: true,
    is_featured: true,
    source: 'manual',
    price_checked_at: null,
  };
}

function sampleTour(fullyBooked = false): Tour {
  const start = daysFromNow(fullyBooked ? 12 : 18);
  const end = daysFromNow(fullyBooked ? 13 : 20);
  return {
    id: fullyBooked ? 'zanzibar' : 'mara',
    title: fullyBooked ? 'Zanzibar Spice Tour, 2 days' : 'Maasai Mara, 3 days',
    destination: fullyBooked ? 'Stone Town, Tanzania' : 'Narok, Kenya',
    start_date: start,
    end_date: end,
    slots: 20,
    booking_deadline: daysFromNow(fullyBooked ? 9 : 14),
    cancellation_deadline: daysFromNow(10),
    cancellation_policy: '',
    summary: '',
    description: '',
    included: [],
    not_included: [],
    meeting_point: '',
    departure_city: '',
    organiser: '',
    slots_left: fullyBooked ? 0 : 3,
    duration_days: fullyBooked ? 2 : 3,
    from_price: fullyBooked ? '260.00' : '380.00',
    options: fullyBooked
      ? []
      : [
          option('regular', 'Regular', 'Shared safari van', '380.00', 1),
          option('vip', 'VIP', 'Private land cruiser and lodge upgrade', '520.00', 1),
          option('couple', 'Couple', 'One room for two', '700.00', 2),
          option('group', 'Group of 6', 'Your own van and guide', '1980.00', 6),
        ],
    photos: [{ id: 'photo', url: scene(fullyBooked ? 'island' : 'savanna') }],
    bookable: !fullyBooked,
    not_bookable_reason: fullyBooked ? 'fully_booked' : null,
    is_featured: !fullyBooked,
    rating: fullyBooked ? { average: 4.6, count: 12 } : { average: 4.8, count: 26 },
  };
}

function option(id: string, name: string, description: string, price: string, people: number) {
  return { id, name, description, price, people_per_unit: people, units_available: null, units_left: null };
}

const NIGHTS = 3;

function rate(id: string, name: string, roomPrice: number, adults: number, children: number, inclusions: string[]) {
  return {
    id,
    name,
    inclusions,
    max_adults: adults,
    max_children: children,
    per_adult_per_night: '0.00',
    available: true,
    nights: NIGHTS,
    room_price: roomPrice.toFixed(2),
    stay_price: roomPrice.toFixed(2),
  };
}

const ROOM_TYPES: HotelRoomType[] = [
  {
    id: 'deluxe',
    name: 'Deluxe Double',
    description: 'Sea view, king bed',
    max_adults: 2,
    max_children: 1,
    rates: [
      rate('deluxe-bb', 'Bed and breakfast', 540, 2, 1, ['Breakfast', 'Free Wi-Fi']),
      rate('deluxe-hb', 'Half board', 690, 2, 1, ['Breakfast and dinner', 'Free Wi-Fi']),
    ],
  },
  {
    id: 'family',
    name: 'Family Suite',
    description: 'Two bedrooms, garden view',
    max_adults: 4,
    max_children: 2,
    rates: [rate('family-bb', 'Bed and breakfast', 960, 4, 2, ['Breakfast', 'Kids club'])],
  },
];

function sampleHotel(): Hotel {
  return {
    id: 'diani',
    name: 'Diani Beach Resort',
    destination: 'Diani, Kenya',
    address: 'Diani Beach Road',
    star_rating: 4,
    summary: '',
    description: '',
    amenities: [],
    check_in_time: '14:00:00',
    check_out_time: '10:00:00',
    cancellation_policy: '',
    is_featured: true,
    from_price: '540.00',
    photos: [{ id: 'photo', url: scene('beach') }],
    room_types: ROOM_TYPES,
    rating: { average: 4.7, count: 41 },
  };
}

/**
 * A browser window holding a real screen laid out `width` wide and scaled down to fit. Decorative: hidden from
 * screen readers and out of the tab order.
 */
export function MockFrame({ width, children }: { width: number; children: ReactNode }) {
  const frame = useRef<ComponentRef<typeof View>>(null);
  const [box, setBox] = useState(0);
  const [height, setHeight] = useState(0);
  const scale = box ? Math.min(1, box / width) : 0;
  useEffect(() => {
    (frame.current as unknown as HTMLElement | null)?.setAttribute?.('inert', '');
  }, []);
  return (
    <View ref={frame} style={styles.window} aria-hidden pointerEvents="none">
      <View style={styles.chrome}>
        <View style={styles.dots}>
          <View style={[styles.dot, { backgroundColor: colors.danger }]} />
          <View style={[styles.dot, { backgroundColor: colors.accent }]} />
          <View style={[styles.dot, { backgroundColor: colors.success }]} />
        </View>
        <View style={styles.address}>
          <Icon name="lock-closed" size={11} color={colors.muted} />
          <Text style={styles.addressText} numberOfLines={1}>
            youragency.{TENANT_BASE_DOMAIN}
          </Text>
        </View>
        <View style={styles.dots} />
      </View>
      <View
        style={[styles.viewport, { height: height * scale }]}
        onLayout={(event) => setBox(event.nativeEvent.layout.width)}
      >
        <View
          style={[styles.page, { width, transform: [{ scale }], opacity: scale ? 1 : 0 }]}
          onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
        >
          {children}
        </View>
      </View>
    </View>
  );
}

/** An agency's Explore All: hero tiles and a featured flight, tour and hotel. */
export function ExploreMock() {
  const wide = useIsWide();
  return (
    <MockFrame width={wide ? 900 : 680}>
      <ExploreHero
        name="Safari Trails Travel"
        modules={['flights', 'tours', 'hotels']}
        wide
        onOpen={noop}
        heading={false}
      />
      <Text style={styles.pageTitle}>Featured this week</Text>
      <View style={styles.row}>
        <View style={styles.third}>
          <FlightCard offer={sampleOffer()} onPress={noop} />
        </View>
        <View style={styles.third}>
          <TourCard tour={sampleTour()} onPress={noop} />
        </View>
        <View style={styles.third}>
          <HotelCard hotel={sampleHotel()} nights={0} onPress={noop} />
        </View>
      </View>
    </MockFrame>
  );
}

/** Offer detail with its route, flight and Book, beside a booking's progress. */
export function FlightMock() {
  const offer = sampleOffer();
  const wide = useIsWide();
  return (
    <MockFrame width={wide ? 880 : 520}>
      <View style={wide ? styles.row : styles.stack}>
        <View style={styles.main}>
          <Card>
            <View style={styles.airline}>
              <AirlineBadge airline={AIRLINE} />
              <View>
                <Text style={styles.strong}>{AIRLINE.name}</Text>
                <Text style={styles.muted}>Economy</Text>
              </View>
            </View>
            <RouteLine origin={NBO} destination={DXB} stopCount={0} size="large" />
          </Card>
          <Card>
            <DirectionDetails label="Outbound" direction={offer.itinerary.outbound} />
          </Card>
        </View>
        <View style={wide ? styles.side : styles.stack}>
          <Card>
            <Text style={styles.muted}>Price per person</Text>
            <PriceTag amount={offer.price} size="large" />
            <Button title="Book" variant="accent" onPress={noop} />
            <FlightServiceRating rating={{ average: 4.8, count: 40 }} />
          </Card>
          <Card>
            <Text style={styles.heading}>Your booking</Text>
            <BookingProgress status="paid" lastLabel="Passes sent" />
          </Card>
        </View>
      </View>
    </MockFrame>
  );
}

/** Tour cards, one nearly full and one fully booked, beside the first one's prices. */
export function TourMock() {
  const tour = sampleTour();
  const wide = useIsWide();
  return (
    <MockFrame width={wide ? 900 : 580}>
      <View style={wide ? styles.row : styles.stack}>
        <View style={styles.main}>
          <View style={styles.row}>
            <View style={styles.half}>
              <TourCard tour={tour} onPress={noop} />
            </View>
            <View style={styles.half}>
              <TourCard tour={sampleTour(true)} onPress={noop} />
            </View>
          </View>
        </View>
        <View style={wide ? styles.side : undefined}>
          <PriceCard tour={tour} onBook={noop} />
        </View>
      </View>
    </MockFrame>
  );
}

/** A hotel's room table with a room picked, and the stay's total. */
export function HotelMock() {
  const hotel = sampleHotel();
  const wide = useIsWide();
  return (
    <MockFrame width={wide ? 860 : 720}>
      <Card>
        <Text style={styles.pageTitle}>{hotel.name}</Text>
        <StarRating stars={hotel.star_rating} size={16} />
        <CardFact icon="location-outline">
          {hotel.address}, {hotel.destination}
        </CardFact>
      </Card>
      <Card>
        <Text style={styles.heading}>Rooms</Text>
        <RoomTable roomTypes={ROOM_TYPES} picked={{ 'deluxe-bb': 1 }} onPick={noop} />
      </Card>
      <Card>
        <View style={styles.summary}>
          <View style={styles.rowText}>
            <Text style={styles.heading}>Your rooms</Text>
            <Text style={styles.muted}>1 × Deluxe Double, Bed and breakfast</Text>
          </View>
          <CardPrice amount="540.00" after={`for ${NIGHTS} nights`} />
          <Button title="Request booking" variant="accent" onPress={noop} />
        </View>
      </Card>
    </MockFrame>
  );
}

function months() {
  const now = new Date();
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + index, 1));
    const flights = 4200 + index * 380 + (index % 3) * 600;
    const tours = 1800 + index * 260 + (index % 4) * 450;
    const hotels = 1500 + index * 210 + (index % 2) * 520;
    return {
      month: date.toISOString().slice(0, 7),
      total: String(flights + tours + hotels),
      count: 18 + index * 2,
      by_module: { flights: String(flights), tours: String(tours), hotels: String(hotels) },
    };
  });
}

function tile(label: string, value: number, icon: IconName, tone: Tile['tone'], emphasised: boolean): Tile {
  return { label, value: String(value), detail: [], icon, tone, emphasised, onPress: noop, action: 'View' };
}

function ComingUpRow({ icon, title, line, chip }: { icon: IconName; title: string; line: string; chip?: string }) {
  return (
    <LinkRow label={title} onPress={noop}>
      <View style={styles.comingUp}>
        <View style={styles.kind}>
          <Icon name={icon} size={16} color={colors.tertiary} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.strong} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {line}
          </Text>
          {chip ? <StatusChip label={chip} tone="warning" /> : null}
        </View>
      </View>
    </LinkRow>
  );
}

/** The agency dashboard: needs-action tiles, sales by month stacked by product, and what is coming up. */
export function DashboardMock() {
  const wide = useIsWide();
  return (
    <MockFrame width={wide ? 1100 : 680}>
      <View>
        <Text style={styles.pageTitle}>Dashboard</Text>
        <Text style={styles.muted}>Good morning, Amina.</Text>
      </View>
      <SectionTitle>Needs action</SectionTitle>
      <TileGrid
        tiles={[
          tile('Flight bookings to confirm', 3, 'checkmark-done-outline', 'warning', true),
          tile('Travellers missing this week', 2, 'people-outline', 'warning', true),
          tile('Hotel bookings to confirm', 1, 'checkmark-done-outline', 'warning', true),
          tile('Open requests', 4, 'chatbubbles-outline', 'info', false),
        ]}
      />
      <Columns>
        <Column>
          <MonthChart
            title="Sales, last 12 months"
            months={months()}
            money={formatPrice}
            empty=""
            countLabel={(count) => `${count} bookings`}
            series={[
              { key: 'flights', label: 'Flights', color: colors.primary },
              { key: 'tours', label: 'Tours', color: colors.accent },
              { key: 'hotels', label: 'Hotels', color: colors.tertiary },
            ]}
          />
        </Column>
        <Column>
          <Card>
            <SectionTitle>Coming up</SectionTitle>
            <ComingUpRow
              icon="location-outline"
              title="Maasai Mara, 3 days"
              line={`Starts ${formatDate(daysFromNow(3))} · 17 of 20 booked`}
              chip="2 travellers missing"
            />
            <ComingUpRow
              icon="airplane-outline"
              title="Grace Wanjiru"
              line={`NBO → DXB · ${formatDate(daysFromNow(4))} · 2 passengers`}
              chip="Passes not sent"
            />
            <ComingUpRow
              icon="bed-outline"
              title="Daniel Otieno"
              line={`Diani Beach Resort · ${formatDate(daysFromNow(5))} · 3 nights, 1 room`}
            />
            <ComingUpRow
              icon="location-outline"
              title="Zanzibar Spice Tour, 2 days"
              line={`Starts ${formatDate(daysFromNow(6))} · 20 of 20 booked`}
            />
          </Card>
        </Column>
      </Columns>
    </MockFrame>
  );
}

const styles = createStyles(() => ({
  window: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadowDialog,
  },
  chrome: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dots: { flexDirection: 'row', gap: 6, width: 50 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  address: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingVertical: 5,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    minWidth: 0,
  },
  addressText: { fontSize: font.caption, color: colors.muted },
  viewport: { width: '100%', overflow: 'hidden', backgroundColor: colors.background },
  page: {
    position: 'absolute',
    top: 0,
    left: 0,
    padding: space.xl,
    gap: space.lg,
    transformOrigin: 'top left',
  },
  pageTitle: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  heading: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  strong: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  text: { fontSize: font.body, color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
  row: { flexDirection: 'row', gap: space.lg, alignItems: 'stretch' },
  stack: { gap: space.lg },
  third: { flex: 1, minWidth: 0 },
  half: { flex: 1, minWidth: 0 },
  main: { flex: 1, minWidth: 0, gap: space.lg },
  side: { width: 300, gap: space.lg },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  airline: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  comingUp: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  kind: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
