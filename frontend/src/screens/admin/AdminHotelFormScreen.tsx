import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage, firstMessage } from '../../api/errors';
import { AdminHotel } from '../../api/types';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DateField } from '../../components/DateField';
import { DetailError } from '../../components/DetailLayout';
import { FieldGrid, FormError } from '../../components/Field';
import { FormFooter, FormSection } from '../../components/FormSection';
import { LinesEditor } from '../../components/LinesEditor';
import { PendingPhotos, SavedPhotos, uploadPendingPhotos } from '../../components/PhotoEditor';
import { RichTextEditor } from '../../components/rich/RichTextEditor';
import { Screen } from '../../components/Screen';
import { SelectField } from '../../components/SelectField';
import { StatusChip } from '../../components/StatusChip';
import { LoadingState } from '../../components/StatusViews';
import { TextField } from '../../components/TextField';
import { TimeField } from '../../components/TimeField';
import { Toggle } from '../../components/Toggle';
import { AdminTabParamList } from '../../navigation/types';
import { colors, createStyles, font, radius, space, weight } from '../../theme';
import { formatDate } from '../../utils/format';

const MAX_PHOTOS = 12;
const MAX_AMENITIES = 30;
const MAX_INCLUSIONS = 10;
const PRICE = /^\d+(\.\d{1,2})?$/;

type PeriodDraft = { start_date: string; end_date: string; price_per_night: string };

type RateDraft = {
  id: string | null;
  name: string;
  inclusions: string[];
  max_adults: string;
  max_children: string;
  per_adult_per_night: string;
  is_active: boolean;
  booked: boolean;
  periods: PeriodDraft[];
};

type RoomTypeDraft = {
  id: string | null;
  name: string;
  description: string;
  max_adults: string;
  max_children: string;
  is_active: boolean;
  booked: boolean;
  rates: RateDraft[];
};

type Values = {
  name: string;
  destination: string;
  address: string;
  star_rating: string;
  summary: string;
  description: string;
  amenities: string[];
  check_in_time: string;
  check_out_time: string;
  cancellation_policy: string;
  is_featured: boolean;
  room_types: RoomTypeDraft[];
};

type Errors = Partial<Record<keyof Values, string>>;

const FIELDS: (keyof Values)[] = [
  'name',
  'destination',
  'address',
  'star_rating',
  'summary',
  'description',
  'amenities',
  'check_in_time',
  'check_out_time',
  'cancellation_policy',
  'is_featured',
  'room_types',
];

const STARS = [
  { value: '', label: 'Not rated' },
  ...[1, 2, 3, 4, 5].map((stars) => ({ value: String(stars), label: `${stars} star${stars === 1 ? '' : 's'}` })),
];

function newRate(): RateDraft {
  return {
    id: null,
    name: '',
    inclusions: [],
    max_adults: '2',
    max_children: '0',
    per_adult_per_night: '0',
    is_active: true,
    booked: false,
    periods: [{ start_date: '', end_date: '', price_per_night: '' }],
  };
}

function newRoomType(): RoomTypeDraft {
  return {
    id: null,
    name: '',
    description: '',
    max_adults: '2',
    max_children: '0',
    is_active: true,
    booked: false,
    rates: [{ ...newRate(), name: 'Bed & breakfast' }],
  };
}

const EMPTY: Values = {
  name: '',
  destination: '',
  address: '',
  star_rating: '',
  summary: '',
  description: '',
  amenities: [],
  check_in_time: '14:00',
  check_out_time: '10:00',
  cancellation_policy: '',
  is_featured: false,
  room_types: [newRoomType()],
};

function toValues(hotel: AdminHotel): Values {
  return {
    name: hotel.name,
    destination: hotel.destination,
    address: hotel.address,
    star_rating: hotel.star_rating ? String(hotel.star_rating) : '',
    summary: hotel.summary,
    description: hotel.description,
    amenities: hotel.amenities,
    check_in_time: hotel.check_in_time.slice(0, 5),
    check_out_time: hotel.check_out_time.slice(0, 5),
    cancellation_policy: hotel.cancellation_policy,
    is_featured: hotel.is_featured,
    room_types: hotel.room_types.map((roomType) => ({
      id: roomType.id,
      name: roomType.name,
      description: roomType.description,
      max_adults: String(roomType.max_adults),
      max_children: String(roomType.max_children),
      is_active: roomType.is_active,
      booked: roomType.booked,
      rates: roomType.rates.map((rate) => ({
        id: rate.id,
        name: rate.name,
        inclusions: rate.inclusions,
        max_adults: String(rate.max_adults),
        max_children: String(rate.max_children),
        per_adult_per_night: rate.per_adult_per_night,
        is_active: rate.is_active,
        booked: rate.booked,
        periods: rate.periods.map(({ start_date, end_date, price_per_night }) => ({
          start_date,
          end_date,
          price_per_night,
        })),
      })),
    })),
  };
}

function whole(value: string, min: number, max: number): boolean {
  return /^\d+$/.test(value.trim()) && Number(value) >= min && Number(value) <= max;
}

/** The first problem with the periods of a rate, or null; overlapping periods are refused. */
export function periodsProblem(periods: PeriodDraft[]): string | null {
  for (const period of periods) {
    if (!period.start_date || !period.end_date) {
      return 'Give every period its start and end dates.';
    }
    if (period.end_date < period.start_date) {
      return "A period can't end before it starts.";
    }
    if (!PRICE.test(period.price_per_night.trim()) || Number(period.price_per_night) <= 0) {
      return 'Enter a price per night greater than 0 for every period.';
    }
  }
  const ordered = [...periods].sort((a, b) => a.start_date.localeCompare(b.start_date));
  for (let index = 1; index < ordered.length; index++) {
    const before = ordered[index - 1];
    const after = ordered[index];
    if (after.start_date <= before.end_date) {
      return `Periods overlap: ${formatDate(before.start_date)} – ${formatDate(before.end_date)} and ${formatDate(after.start_date)} – ${formatDate(after.end_date)}.`;
    }
  }
  return null;
}

function roomTypesProblem(roomTypes: RoomTypeDraft[]): string | null {
  const typeNames = new Set<string>();
  for (const roomType of roomTypes) {
    const name = roomType.name.trim();
    if (!name) {
      return 'Give every room type a name.';
    }
    if (typeNames.has(name.toLowerCase())) {
      return 'Each room type needs a different name.';
    }
    typeNames.add(name.toLowerCase());
    if (!whole(roomType.max_adults, 1, 10) || !whole(roomType.max_children, 0, 6)) {
      return `${name}: from 1 to 10 adults and 0 to 6 children.`;
    }
    const rateNames = new Set<string>();
    for (const rate of roomType.rates) {
      const rateName = rate.name.trim();
      if (!rateName) {
        return `${name}: give every rate a name.`;
      }
      if (rateNames.has(rateName.toLowerCase())) {
        return `${name}: each rate needs a different name.`;
      }
      rateNames.add(rateName.toLowerCase());
      if (
        !whole(rate.max_adults, 1, Number(roomType.max_adults)) ||
        !whole(rate.max_children, 0, Number(roomType.max_children))
      ) {
        return `${name}, ${rateName}: at most the room's ${roomType.max_adults} adults and ${roomType.max_children} children.`;
      }
      if (!PRICE.test(rate.per_adult_per_night.trim())) {
        return `${name}, ${rateName}: enter the per-adult charge (0 for none).`;
      }
      const lines = rate.inclusions.filter((line) => line.trim());
      if (lines.length > MAX_INCLUSIONS || lines.some((line) => line.length > 80)) {
        return `${name}, ${rateName}: at most ${MAX_INCLUSIONS} inclusions of 80 characters.`;
      }
      const problem = periodsProblem(rate.periods);
      if (problem) {
        return `${name}, ${rateName}: ${problem}`;
      }
    }
  }
  return null;
}

function validate(values: Values): Errors {
  const errors: Errors = {};
  const required: [keyof Values, string][] = [
    ['name', "Enter the hotel's name."],
    ['destination', 'Enter the destination.'],
    ['address', 'Enter the address.'],
    ['summary', 'Enter a short summary.'],
    ['check_in_time', 'Enter the check-in time.'],
    ['check_out_time', 'Enter the check-out time.'],
    ['cancellation_policy', 'Enter the cancellation policy.'],
  ];
  for (const [field, message] of required) {
    if (!String(values[field]).trim()) {
      errors[field] = message;
    }
  }
  const amenities = values.amenities.filter((line) => line.trim());
  if (amenities.length > MAX_AMENITIES || amenities.some((line) => line.length > 100)) {
    errors.amenities = `At most ${MAX_AMENITIES} lines of 100 characters.`;
  }
  const problem = roomTypesProblem(values.room_types);
  if (problem) {
    errors.room_types = problem;
  }
  return errors;
}

function lines(values: string[]): string[] {
  return values.map((line) => line.trim()).filter(Boolean);
}

function toBody(values: Values) {
  return {
    name: values.name.trim(),
    destination: values.destination.trim(),
    address: values.address.trim(),
    star_rating: values.star_rating ? Number(values.star_rating) : null,
    summary: values.summary.trim(),
    description: values.description,
    amenities: lines(values.amenities),
    check_in_time: values.check_in_time,
    check_out_time: values.check_out_time,
    cancellation_policy: values.cancellation_policy.trim(),
    is_featured: values.is_featured,
    room_types: values.room_types.map((roomType) => ({
      ...(roomType.id ? { id: roomType.id } : {}),
      name: roomType.name.trim(),
      description: roomType.description.trim(),
      max_adults: Number(roomType.max_adults),
      max_children: Number(roomType.max_children),
      is_active: roomType.is_active,
      rates: roomType.rates.map((rate) => ({
        ...(rate.id ? { id: rate.id } : {}),
        name: rate.name.trim(),
        inclusions: lines(rate.inclusions),
        max_adults: Number(rate.max_adults),
        max_children: Number(rate.max_children),
        per_adult_per_night: rate.per_adult_per_night.trim(),
        is_active: rate.is_active,
        periods: rate.periods.map((period) => ({ ...period, price_per_night: period.price_per_night.trim() })),
      })),
    })),
  };
}

function moved<T>(items: T[], index: number, by: number): T[] {
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(index + by, 0, item);
  return next;
}

export function AdminHotelNewScreen({ navigation }: BottomTabScreenProps<AdminTabParamList, 'AdminHotelNew'>) {
  const back = () => navigation.navigate('AdminHotels', { tab: 'hotels' });
  return (
    <Screen maxWidth={900}>
      <BackLink label="Hotels" onPress={back} />
      <Text style={styles.title}>New hotel</Text>
      <HotelForm
        initial={EMPTY}
        onCancel={back}
        onSaved={(hotel) => navigation.navigate('AdminHotels', { tab: 'hotels', id: hotel.id })}
      />
    </Screen>
  );
}

export function AdminHotelEditScreen({ navigation, route }: BottomTabScreenProps<AdminTabParamList, 'AdminHotelEdit'>) {
  const { id } = route.params;
  const hotel = useQuery({
    queryKey: ['admin', 'hotels', 'detail', id],
    queryFn: async () => (await api.get<AdminHotel>(`/admin/hotels/${id}`)).data,
  });
  const back = () => navigation.navigate('AdminHotels', { tab: 'hotels', id });
  return (
    <Screen maxWidth={900}>
      <BackLink label="Hotel" onPress={back} />
      <Text style={styles.title}>Edit hotel</Text>
      {hotel.isPending ? (
        <LoadingState />
      ) : hotel.isError ? (
        <Card>
          <DetailError error={hotel.error} onRetry={() => hotel.refetch()} notFound="Hotel not found" />
        </Card>
      ) : (
        <HotelForm
          key={hotel.data.id}
          hotel={hotel.data}
          initial={toValues(hotel.data)}
          onCancel={back}
          onSaved={back}
        />
      )}
    </Screen>
  );
}

type FormProps = {
  hotel?: AdminHotel;
  initial: Values;
  onCancel: () => void;
  onSaved: (hotel: AdminHotel) => void;
};

function HotelForm({ hotel, initial, onCancel, onSaved }: FormProps) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<File[]>([]);
  const set = <K extends keyof Values>(field: K, value: Values[K]) =>
    setValues((current) => ({ ...current, [field]: value }));

  const submit = async () => {
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length) {
      setFormError('Check the highlighted fields.');
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const body = toBody(values);
      const { data } = hotel
        ? await api.patch<AdminHotel>(`/admin/hotels/${hotel.id}`, body)
        : await api.post<AdminHotel>('/admin/hotels', body);
      await uploadPendingPhotos(`/admin/hotels/${data.id}/photos`, pending);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'hotels'] });
      onSaved(data);
    } catch (error) {
      const response = isAxiosError(error) ? (error.response?.data as Record<string, unknown> | undefined) : undefined;
      const fields: Errors = {};
      for (const field of FIELDS) {
        const message = firstMessage(response?.[field]);
        if (message) {
          fields[field] = message;
        }
      }
      setErrors(fields);
      setFormError(Object.keys(fields).length ? 'Check the highlighted fields.' : errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <FormSection title="Hotel">
        <TextField
          label="Name"
          placeholder="e.g. Diani Reef Beach Resort"
          value={values.name}
          onChangeText={(text) => set('name', text)}
          error={errors.name}
          maxLength={120}
        />
        <FieldGrid columns={2}>
          <TextField
            label="Destination"
            placeholder="e.g. Diani Beach, Kenya"
            value={values.destination}
            onChangeText={(text) => set('destination', text)}
            error={errors.destination}
            maxLength={120}
          />
          <TextField
            label="Address"
            value={values.address}
            onChangeText={(text) => set('address', text)}
            error={errors.address}
            maxLength={200}
          />
        </FieldGrid>
        <FieldGrid>
          <SelectField
            label="Star rating"
            options={STARS}
            value={values.star_rating}
            onChange={(value) => set('star_rating', value)}
            error={errors.star_rating}
          />
          <TimeField
            label="Check-in from"
            value={values.check_in_time}
            onChange={(time) => set('check_in_time', time)}
            error={errors.check_in_time}
          />
          <TimeField
            label="Check-out by"
            value={values.check_out_time}
            onChange={(time) => set('check_out_time', time)}
            error={errors.check_out_time}
          />
        </FieldGrid>
        <TextField
          label="Summary (shown on cards)"
          value={values.summary}
          onChangeText={(text) => set('summary', text)}
          error={errors.summary}
          multiline
          numberOfLines={2}
          maxLength={300}
        />
        <RichTextEditor
          label="Description (optional)"
          value={values.description}
          onChange={(html) => set('description', html)}
          error={errors.description}
        />
        <LinesEditor
          label="Amenities"
          lines={values.amenities}
          onChange={(amenities) => set('amenities', amenities)}
          maxLines={MAX_AMENITIES}
          maxLength={100}
          error={errors.amenities}
        />
        <TextField
          label="Cancellation policy"
          value={values.cancellation_policy}
          onChangeText={(text) => set('cancellation_policy', text)}
          error={errors.cancellation_policy}
          multiline
          numberOfLines={3}
          maxLength={2000}
        />
        <Toggle label="Feature on Explore" value={values.is_featured} onChange={(value) => set('is_featured', value)} />
      </FormSection>

      <FormSection
        title="Rooms and rates"
        description="Each rate is a row of the room table: what is offered, for how many people, priced per night by season."
      >
        <RoomTypesEditor roomTypes={values.room_types} onChange={(roomTypes) => set('room_types', roomTypes)} />
        <FormError message={errors.room_types} />
      </FormSection>

      <FormSection title="Photos" description="PNG, JPEG or WebP up to 2 MB, at most 12. The first is the cover.">
        {hotel ? (
          <SavedPhotos
            path={`/admin/hotels/${hotel.id}/photos`}
            initial={hotel.photos}
            max={MAX_PHOTOS}
            queryKey={['admin', 'hotels']}
          />
        ) : (
          <PendingPhotos files={pending} onChange={setPending} max={MAX_PHOTOS} noun="hotel" />
        )}
      </FormSection>

      <FormError message={formError} />
      <FormFooter>
        <Button title="Cancel" variant="secondary" onPress={onCancel} disabled={saving} />
        <Button title={hotel ? 'Save changes' : 'Create hotel'} onPress={submit} loading={saving} />
      </FormFooter>
    </>
  );
}

function ItemActions({
  index,
  count,
  booked,
  onMove,
  onDelete,
}: {
  index: number;
  count: number;
  booked: boolean;
  onMove: (by: number) => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.row}>
      <Button title="Up" variant="link" disabled={index === 0} onPress={() => onMove(-1)} />
      <Button title="Down" variant="link" disabled={index === count - 1} onPress={() => onMove(1)} />
      {!booked ? <Button title="Delete" variant="link" onPress={onDelete} /> : null}
    </View>
  );
}

function RoomTypesEditor({
  roomTypes,
  onChange,
}: {
  roomTypes: RoomTypeDraft[];
  onChange: (roomTypes: RoomTypeDraft[]) => void;
}) {
  const update = (index: number, changes: Partial<RoomTypeDraft>) =>
    onChange(roomTypes.map((roomType, other) => (other === index ? { ...roomType, ...changes } : roomType)));
  return (
    <View style={styles.list}>
      {roomTypes.map((roomType, index) => {
        const label = roomType.name.trim() || `Room type ${index + 1}`;
        return (
          <View key={roomType.id ?? `new-${index}`} style={styles.item}>
            <View style={styles.between}>
              <View style={styles.row}>
                <Text style={styles.heading}>{label}</Text>
                {roomType.booked ? <StatusChip label="Booked" tone="info" /> : null}
                {!roomType.is_active ? <StatusChip label="Inactive" tone="neutral" /> : null}
              </View>
              <ItemActions
                index={index}
                count={roomTypes.length}
                booked={roomType.booked}
                onMove={(by) => onChange(moved(roomTypes, index, by))}
                onDelete={() => onChange(roomTypes.filter((_, other) => other !== index))}
              />
            </View>
            <FieldGrid>
              <TextField
                label="Name"
                accessibilityLabel={`Room type ${index + 1} name`}
                placeholder="e.g. Deluxe Double, Family Tent"
                value={roomType.name}
                onChangeText={(name) => update(index, { name })}
                maxLength={80}
              />
              <TextField
                label="Max adults"
                accessibilityLabel={`${label} max adults`}
                value={roomType.max_adults}
                onChangeText={(max_adults) => update(index, { max_adults })}
                keyboardType="number-pad"
              />
              <TextField
                label="Max children"
                accessibilityLabel={`${label} max children`}
                value={roomType.max_children}
                onChangeText={(max_children) => update(index, { max_children })}
                keyboardType="number-pad"
              />
            </FieldGrid>
            <TextField
              label="Description (optional)"
              accessibilityLabel={`${label} description`}
              value={roomType.description}
              onChangeText={(description) => update(index, { description })}
              maxLength={300}
            />
            <Toggle
              label={roomType.is_active ? 'Offered' : 'Not offered'}
              value={roomType.is_active}
              onChange={(is_active) => update(index, { is_active })}
            />
            <RatesEditor roomName={label} rates={roomType.rates} onChange={(rates) => update(index, { rates })} />
          </View>
        );
      })}
      <View style={styles.start}>
        <Button
          title="Add room type"
          icon="add"
          variant="secondary"
          onPress={() => onChange([...roomTypes, newRoomType()])}
        />
      </View>
    </View>
  );
}

function RatesEditor({
  roomName,
  rates,
  onChange,
}: {
  roomName: string;
  rates: RateDraft[];
  onChange: (rates: RateDraft[]) => void;
}) {
  const update = (index: number, changes: Partial<RateDraft>) =>
    onChange(rates.map((rate, other) => (other === index ? { ...rate, ...changes } : rate)));
  return (
    <View style={styles.list}>
      {rates.map((rate, index) => {
        const label = `${roomName}, ${rate.name.trim() || `rate ${index + 1}`}`;
        return (
          <View key={rate.id ?? `new-${index}`} style={styles.rate}>
            <View style={styles.between}>
              <View style={styles.row}>
                <Text style={styles.strong}>{rate.name.trim() || `Rate ${index + 1}`}</Text>
                {rate.booked ? <StatusChip label="Booked" tone="info" /> : null}
                {!rate.is_active ? <StatusChip label="Inactive" tone="neutral" /> : null}
              </View>
              <ItemActions
                index={index}
                count={rates.length}
                booked={rate.booked}
                onMove={(by) => onChange(moved(rates, index, by))}
                onDelete={() => onChange(rates.filter((_, other) => other !== index))}
              />
            </View>
            <FieldGrid>
              <TextField
                label="Rate name"
                accessibilityLabel={`${label} name`}
                placeholder="e.g. Bed & breakfast"
                value={rate.name}
                onChangeText={(name) => update(index, { name })}
                maxLength={60}
              />
              <TextField
                label="Adults"
                accessibilityLabel={`${label} adults`}
                value={rate.max_adults}
                onChangeText={(max_adults) => update(index, { max_adults })}
                keyboardType="number-pad"
              />
              <TextField
                label="Children"
                accessibilityLabel={`${label} children`}
                value={rate.max_children}
                onChangeText={(max_children) => update(index, { max_children })}
                keyboardType="number-pad"
              />
              <TextField
                label="Per adult per night (USD)"
                accessibilityLabel={`${label} per adult per night`}
                value={rate.per_adult_per_night}
                onChangeText={(per_adult_per_night) => update(index, { per_adult_per_night })}
                keyboardType="decimal-pad"
              />
            </FieldGrid>
            <LinesEditor
              label="Inclusions"
              lines={rate.inclusions}
              onChange={(inclusions) => update(index, { inclusions })}
              maxLines={MAX_INCLUSIONS}
              maxLength={80}
            />
            <PeriodsEditor label={label} periods={rate.periods} onChange={(periods) => update(index, { periods })} />
            <Toggle
              label={rate.is_active ? 'Offered' : 'Not offered'}
              value={rate.is_active}
              onChange={(is_active) => update(index, { is_active })}
            />
          </View>
        );
      })}
      <View style={styles.start}>
        <Button title="Add rate" icon="add" variant="secondary" onPress={() => onChange([...rates, newRate()])} />
      </View>
    </View>
  );
}

function PeriodsEditor({
  label,
  periods,
  onChange,
}: {
  label: string;
  periods: PeriodDraft[];
  onChange: (periods: PeriodDraft[]) => void;
}) {
  const update = (index: number, changes: Partial<PeriodDraft>) =>
    onChange(periods.map((period, other) => (other === index ? { ...period, ...changes } : period)));
  const complete = periods.every((period) => period.start_date && period.end_date && period.price_per_night);
  const problem = complete ? periodsProblem(periods) : null;
  return (
    <Card>
      <Text style={styles.strong}>Prices by season</Text>
      {periods.map((period, index) => (
        <View key={index} style={styles.periodRow}>
          <View style={styles.grow}>
            <FieldGrid>
              <DateField
                label="From"
                accessibilityLabel={`${label} period ${index + 1} from`}
                value={period.start_date}
                onChange={(start_date) => update(index, { start_date })}
              />
              <DateField
                label="To"
                accessibilityLabel={`${label} period ${index + 1} to`}
                value={period.end_date}
                onChange={(end_date) => update(index, { end_date })}
              />
              <TextField
                label="Price per night (USD)"
                accessibilityLabel={`${label} period ${index + 1} price per night`}
                value={period.price_per_night}
                onChangeText={(price_per_night) => update(index, { price_per_night })}
                keyboardType="decimal-pad"
              />
            </FieldGrid>
          </View>
          <Button
            title="Remove"
            variant="link"
            onPress={() => onChange(periods.filter((_, other) => other !== index))}
          />
        </View>
      ))}
      <FormError message={problem} />
      <View style={styles.start}>
        <Button
          title="Add period"
          icon="add"
          variant="secondary"
          onPress={() => onChange([...periods, { start_date: '', end_date: '', price_per_night: '' }])}
        />
      </View>
    </Card>
  );
}

const styles = createStyles(() => ({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  heading: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  strong: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  list: { gap: space.md },
  item: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  rate: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  periodRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, flexWrap: 'wrap' },
  grow: { flexGrow: 1, flexBasis: 260, minWidth: 0 },
  start: { alignSelf: 'flex-start' },
}));
