import { Pressable, Text, View } from 'react-native';

import { Hotel } from '../../api/types';
import { CoverImage } from '../../components/CoverImage';
import { DateField } from '../../components/DateField';
import { FieldGrid } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { PressState } from '../../components/pressState';
import { SelectField } from '../../components/SelectField';
import { HotelStay } from '../../navigation/types';
import { colors, createStyles, font, radius, shadow, space, weight } from '../../theme';
import { formatPrice, todayInNairobi } from '../../utils/format';
import { MAX_NIGHTS, nightsBetween, nightsLabel } from '../../utils/hotels';

/** The stay and guests as typed; adults blank: any. */
export type Stay = { check_in: string; check_out: string; adults: string; children: string };
export type StayErrors = Partial<Record<keyof Stay, string>>;

export const EMPTY_STAY: Stay = { check_in: '', check_out: '', adults: '', children: '0' };

const ADULTS = [
  { value: '', label: 'Any' },
  ...Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) })),
];
const CHILDREN = Array.from({ length: 7 }, (_, index) => ({ value: String(index), label: String(index) }));

export function validateStay(stay: Stay): StayErrors {
  const errors: StayErrors = {};
  if (Boolean(stay.check_in) !== Boolean(stay.check_out)) {
    errors[stay.check_in ? 'check_out' : 'check_in'] = 'Choose both dates.';
  } else if (stay.check_in) {
    const nights = nightsBetween(stay.check_in, stay.check_out);
    if (stay.check_in < todayInNairobi()) {
      errors.check_in = 'Check-in cannot be in the past.';
    } else if (nights < 1 || nights > MAX_NIGHTS) {
      errors.check_out = `A stay is from 1 to ${MAX_NIGHTS} nights.`;
    }
  }
  return errors;
}

/** The stay as API and URL params, leaving out what is not chosen. */
export function stayParams(stay: Stay): HotelStay {
  const params: HotelStay = {};
  if (stay.check_in && stay.check_out) {
    params.check_in = stay.check_in;
    params.check_out = stay.check_out;
  }
  if (stay.adults) {
    params.adults = stay.adults;
  }
  if (stay.children && stay.children !== '0') {
    params.children = stay.children;
  }
  return params;
}

export function stayFrom(params: HotelStay | undefined): Stay {
  return {
    check_in: params?.check_in ?? '',
    check_out: params?.check_out ?? '',
    adults: params?.adults ?? '',
    children: params?.children ?? '0',
  };
}

/** Check-in, check-out and guests. */
export function StayFields({
  value,
  onChange,
  errors,
}: {
  value: Stay;
  onChange: (value: Stay) => void;
  errors: StayErrors;
}) {
  return (
    <FieldGrid>
      <DateField
        label="Check-in"
        value={value.check_in}
        onChange={(check_in) => onChange({ ...value, check_in })}
        error={errors.check_in}
      />
      <DateField
        label="Check-out"
        value={value.check_out}
        onChange={(check_out) => onChange({ ...value, check_out })}
        error={errors.check_out}
      />
      <SelectField
        label="Adults"
        options={ADULTS}
        value={value.adults}
        onChange={(adults) => onChange({ ...value, adults })}
      />
      <SelectField
        label="Children"
        options={CHILDREN}
        value={value.children}
        onChange={(children) => onChange({ ...value, children })}
      />
    </FieldGrid>
  );
}

export function StarRating({ stars, size = 14 }: { stars: number | null; size?: number }) {
  if (!stars) {
    return null;
  }
  return (
    <View style={styles.stars} accessibilityLabel={`${stars}-star`} accessible>
      {Array.from({ length: stars }, (_, index) => (
        <Icon key={index} name="star" size={size} color={colors.accent} />
      ))}
    </View>
  );
}

/** A hotel in a list: cover, name, stars, destination and its from price. */
export function HotelCard({ hotel, nights, onPress }: { hotel: Hotel; nights: number; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${hotel.name}, ${hotel.destination}`}
      onPress={onPress}
      style={({ hovered }: PressState) => [styles.card, hovered && styles.hovered]}
    >
      <CoverImage url={hotel.photos[0]?.url} height={170} />
      <View style={styles.cardBody}>
        <Text style={styles.title} numberOfLines={2}>
          {hotel.name}
        </Text>
        <StarRating stars={hotel.star_rating} />
        <View style={styles.fact}>
          <Icon name="location-outline" size={16} color={colors.muted} />
          <Text style={styles.muted} numberOfLines={1}>
            {hotel.destination}
          </Text>
        </View>
        {hotel.from_price ? (
          nights ? (
            <Text style={styles.from}>
              <Text style={styles.priceText}>{formatPrice(hotel.from_price)}</Text> for {nightsLabel(nights)}
            </Text>
          ) : (
            <Text style={styles.from}>
              From <Text style={styles.priceText}>{formatPrice(hotel.from_price)}</Text> per night
            </Text>
          )
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = createStyles(() => ({
  stars: { flexDirection: 'row', gap: 2 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow,
  },
  hovered: { borderColor: colors.primary },
  cardBody: { padding: space.lg, gap: space.sm },
  title: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  muted: { fontSize: font.small, color: colors.muted, flexShrink: 1 },
  from: { fontSize: font.small, color: colors.text },
  priceText: { fontSize: font.heading, fontWeight: weight.heavy, color: colors.text },
}));
