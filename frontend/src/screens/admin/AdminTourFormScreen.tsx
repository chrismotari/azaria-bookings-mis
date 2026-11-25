import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { api } from '../../api/client';
import { errorMessage, firstMessage } from '../../api/errors';
import { AdminTour } from '../../api/types';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DateField } from '../../components/DateField';
import { DetailError } from '../../components/DetailLayout';
import { Dialog } from '../../components/Dialog';
import { FieldGrid, FormError } from '../../components/Field';
import { FormFooter, FormSection } from '../../components/FormSection';
import { LinesEditor } from '../../components/LinesEditor';
import { PendingPhotos, SavedPhotos, uploadPendingPhotos } from '../../components/PhotoEditor';
import { RichTextEditor } from '../../components/rich/RichTextEditor';
import { Screen } from '../../components/Screen';
import { StatusChip } from '../../components/StatusChip';
import { LoadingState } from '../../components/StatusViews';
import { TextField } from '../../components/TextField';
import { Toggle } from '../../components/Toggle';
import { AdminTabParamList } from '../../navigation/types';
import { colors, createStyles, font, radius, space, weight } from '../../theme';
import { dayBefore, peopleLabel } from '../../utils/tours';

const MAX_LINES = 30;
const MAX_PHOTOS = 8;
const PRICE = /^\d+(\.\d{1,2})?$/;

type OptionDraft = {
  id: string | null;
  name: string;
  description: string;
  price: string;
  people_per_unit: string;
  units_available: string;
  is_active: boolean;
  booked: boolean;
  units_sold: number;
};

type Values = {
  title: string;
  destination: string;
  start_date: string;
  end_date: string;
  slots: string;
  booking_deadline: string;
  cancellation_deadline: string;
  cancellation_policy: string;
  summary: string;
  description: string;
  included: string[];
  not_included: string[];
  meeting_point: string;
  is_featured: boolean;
  options: OptionDraft[];
};

type Errors = Partial<Record<keyof Values, string>>;

const FIELDS: (keyof Values)[] = [
  'title',
  'destination',
  'start_date',
  'end_date',
  'slots',
  'booking_deadline',
  'cancellation_deadline',
  'cancellation_policy',
  'summary',
  'description',
  'included',
  'not_included',
  'meeting_point',
  'is_featured',
  'options',
];

function newOption(): OptionDraft {
  return {
    id: null,
    name: '',
    description: '',
    price: '',
    people_per_unit: '1',
    units_available: '',
    is_active: true,
    booked: false,
    units_sold: 0,
  };
}

const EMPTY: Values = {
  title: '',
  destination: '',
  start_date: '',
  end_date: '',
  slots: '',
  booking_deadline: '',
  cancellation_deadline: '',
  cancellation_policy: '',
  summary: '',
  description: '',
  included: [],
  not_included: [],
  meeting_point: '',
  is_featured: false,
  options: [{ ...newOption(), name: 'Regular' }],
};

function toValues(tour: AdminTour): Values {
  return {
    title: tour.title,
    destination: tour.destination,
    start_date: tour.start_date,
    end_date: tour.end_date,
    slots: String(tour.slots),
    booking_deadline: tour.booking_deadline,
    cancellation_deadline: tour.cancellation_deadline,
    cancellation_policy: tour.cancellation_policy,
    summary: tour.summary,
    description: tour.description,
    included: tour.included,
    not_included: tour.not_included,
    meeting_point: tour.meeting_point,
    is_featured: tour.is_featured,
    options: tour.options.map((option) => ({
      id: option.id,
      name: option.name,
      description: option.description,
      price: option.price,
      people_per_unit: String(option.people_per_unit),
      units_available: option.units_available === null ? '' : String(option.units_available),
      is_active: option.is_active,
      booked: option.booked,
      units_sold: option.units_sold,
    })),
  };
}

function validate(values: Values, booked: number): Errors {
  const errors: Errors = {};
  const required: [keyof Values, string][] = [
    ['title', "Enter the tour's title."],
    ['destination', 'Enter the destination.'],
    ['start_date', 'Choose the start date.'],
    ['end_date', 'Choose the end date.'],
    ['booking_deadline', 'Choose the last day to book.'],
    ['cancellation_deadline', 'Choose the last day to cancel.'],
    ['cancellation_policy', 'Enter the cancellation policy.'],
    ['summary', 'Enter a short summary.'],
  ];
  for (const [field, message] of required) {
    if (!String(values[field]).trim()) {
      errors[field] = message;
    }
  }
  const slots = Number(values.slots);
  if (!/^\d+$/.test(values.slots.trim()) || slots < 1 || slots > 500) {
    errors.slots = 'From 1 to 500 people.';
  } else if (slots < booked) {
    errors.slots = `${peopleLabel(booked)} already booked: slots cannot be fewer.`;
  }
  if (values.start_date && values.end_date && values.end_date < values.start_date) {
    errors.end_date = "The tour can't end before it starts.";
  }
  if (values.start_date && values.booking_deadline > values.start_date) {
    errors.booking_deadline = 'Bookings must close on or before the start date.';
  }
  if (values.start_date && values.cancellation_deadline > values.start_date) {
    errors.cancellation_deadline = 'Free cancellation must end on or before the start date.';
  }
  for (const field of ['included', 'not_included'] as const) {
    const lines = values[field].filter((line) => line.trim());
    if (lines.length > MAX_LINES || lines.some((line) => line.length > 200)) {
      errors[field] = `At most ${MAX_LINES} lines of 200 characters.`;
    }
  }
  const optionError = validateOptions(values.options);
  if (optionError) {
    errors.options = optionError;
  }
  return errors;
}

function validateOptions(options: OptionDraft[]): string | null {
  if (!options.some((option) => option.is_active)) {
    return 'Add at least one active price option.';
  }
  const names = new Set<string>();
  for (const option of options) {
    const name = option.name.trim();
    if (!name) {
      return 'Give every option a name.';
    }
    if (names.has(name.toLowerCase())) {
      return 'Each option needs a different name.';
    }
    names.add(name.toLowerCase());
    if (!PRICE.test(option.price.trim()) || Number(option.price) <= 0) {
      return `${name}: enter a price greater than 0.`;
    }
    const people = Number(option.people_per_unit);
    if (!/^\d+$/.test(option.people_per_unit.trim()) || people < 1 || people > 20) {
      return `${name}: people per unit from 1 to 20.`;
    }
    if (option.units_available.trim()) {
      const units = Number(option.units_available);
      if (!/^\d+$/.test(option.units_available.trim()) || units < 1) {
        return `${name}: units available from 1, or blank for no limit.`;
      }
      if (units < option.units_sold) {
        return `${name}: ${option.units_sold} already booked, so units cannot be fewer.`;
      }
    }
  }
  return null;
}

function toBody(values: Values) {
  return {
    ...values,
    title: values.title.trim(),
    destination: values.destination.trim(),
    slots: Number(values.slots),
    cancellation_policy: values.cancellation_policy.trim(),
    summary: values.summary.trim(),
    meeting_point: values.meeting_point.trim(),
    included: values.included.map((line) => line.trim()).filter(Boolean),
    not_included: values.not_included.map((line) => line.trim()).filter(Boolean),
    options: values.options.map((option) => ({
      ...(option.id ? { id: option.id } : {}),
      name: option.name.trim(),
      description: option.description.trim(),
      price: option.price.trim(),
      people_per_unit: Number(option.people_per_unit),
      units_available: option.units_available.trim() ? Number(option.units_available) : null,
      is_active: option.is_active,
    })),
  };
}

export function AdminTourNewScreen({ navigation }: BottomTabScreenProps<AdminTabParamList, 'AdminTourNew'>) {
  const back = () => navigation.navigate('AdminTours');
  return (
    <Screen maxWidth={860}>
      <BackLink label="Tours" onPress={back} />
      <Text style={styles.title}>New tour</Text>
      <TourForm
        initial={EMPTY}
        onCancel={back}
        onSaved={(tour) => navigation.navigate('AdminTours', { id: tour.id })}
      />
    </Screen>
  );
}

export function AdminTourEditScreen({ navigation, route }: BottomTabScreenProps<AdminTabParamList, 'AdminTourEdit'>) {
  const { id } = route.params;
  const tour = useQuery({
    queryKey: ['admin', 'tours', 'detail', id],
    queryFn: async () => (await api.get<AdminTour>(`/admin/tours/${id}`)).data,
  });
  const back = () => navigation.navigate('AdminTours', { id });
  return (
    <Screen maxWidth={860}>
      <BackLink label="Tour" onPress={back} />
      <Text style={styles.title}>Edit tour</Text>
      {tour.isPending ? (
        <LoadingState />
      ) : tour.isError ? (
        <Card>
          <DetailError error={tour.error} onRetry={() => tour.refetch()} notFound="Tour not found" />
        </Card>
      ) : tour.data.cancelled_at ? (
        <Card>
          <Text style={styles.text}>This tour has been cancelled and can no longer be edited.</Text>
        </Card>
      ) : (
        <TourForm key={tour.data.id} tour={tour.data} initial={toValues(tour.data)} onCancel={back} onSaved={back} />
      )}
    </Screen>
  );
}

type FormProps = {
  tour?: AdminTour;
  initial: Values;
  onCancel: () => void;
  onSaved: (tour: AdminTour) => void;
};

function TourForm({ tour, initial, onCancel, onSaved }: FormProps) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [askNotice, setAskNotice] = useState(false);
  const [pending, setPending] = useState<File[]>([]);
  const set = <K extends keyof Values>(field: K, value: Values[K]) =>
    setValues((current) => ({ ...current, [field]: value }));

  const setStart = (start_date: string) => {
    setValues((current) => {
      const proposed = current.start_date ? dayBefore(current.start_date) : '';
      const follow = (deadline: string) => (!deadline || deadline === proposed ? dayBefore(start_date) : deadline);
      return {
        ...current,
        start_date,
        booking_deadline: start_date ? follow(current.booking_deadline) : current.booking_deadline,
        cancellation_deadline: start_date ? follow(current.cancellation_deadline) : current.cancellation_deadline,
      };
    });
  };

  const save = async (notice?: string) => {
    setFormError(null);
    setSaving(true);
    try {
      const body = { ...toBody(values), ...(notice ? { notice } : {}) };
      const { data } = tour
        ? await api.patch<AdminTour>(`/admin/tours/${tour.id}`, body)
        : await api.post<AdminTour>('/admin/tours', body);
      await uploadPendingPhotos(`/admin/tours/${data.id}/photos`, pending);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'tours'] });
      setAskNotice(false);
      onSaved(data);
    } catch (error) {
      setAskNotice(false);
      const body = isAxiosError(error) ? (error.response?.data as Record<string, unknown> | undefined) : undefined;
      const found: Errors = {};
      let placed = false;
      for (const field of FIELDS) {
        const message = firstMessage(body?.[field]);
        if (message) {
          found[field] = message;
          placed = true;
        }
      }
      setErrors(found);
      setFormError(placed ? 'Check the highlighted fields.' : errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    const found = validate(values, tour?.booked ?? 0);
    setErrors(found);
    if (Object.keys(found).length) {
      setFormError('Check the highlighted fields.');
      return;
    }
    if (tour && tour.confirmed_bookings > 0) {
      setAskNotice(true);
      return;
    }
    void save();
  };

  return (
    <>
      <FormSection title="Tour">
        <TextField
          label="Title"
          placeholder="e.g. Maasai Mara, 3 days"
          value={values.title}
          onChangeText={(text) => set('title', text)}
          error={errors.title}
          maxLength={120}
        />
        <FieldGrid columns={2}>
          <TextField
            label="Destination"
            placeholder="e.g. Maasai Mara, Kenya"
            value={values.destination}
            onChangeText={(text) => set('destination', text)}
            error={errors.destination}
            maxLength={120}
          />
          <TextField
            label="Meeting point (optional)"
            placeholder="e.g. Nairobi CBD, Hilton"
            value={values.meeting_point}
            onChangeText={(text) => set('meeting_point', text)}
            error={errors.meeting_point}
            maxLength={200}
          />
        </FieldGrid>
        <FieldGrid>
          <DateField label="Start date" value={values.start_date} onChange={setStart} error={errors.start_date} />
          <DateField
            label="End date"
            value={values.end_date}
            onChange={(date) => set('end_date', date)}
            error={errors.end_date}
          />
          <TextField
            label="Slots (people)"
            value={values.slots}
            onChangeText={(text) => set('slots', text)}
            error={errors.slots}
            keyboardType="number-pad"
            placeholder="e.g. 20"
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
        <Toggle label="Feature on Explore" value={values.is_featured} onChange={(value) => set('is_featured', value)} />
      </FormSection>

      <FormSection title="Booking and cancelling" description="Both deadlines are the last day, until midnight.">
        <FieldGrid columns={2}>
          <DateField
            label="Last day to book"
            value={values.booking_deadline}
            onChange={(date) => set('booking_deadline', date)}
            error={errors.booking_deadline}
          />
          <DateField
            label="Last day to cancel"
            value={values.cancellation_deadline}
            onChange={(date) => set('cancellation_deadline', date)}
            error={errors.cancellation_deadline}
          />
        </FieldGrid>
        <TextField
          label="Cancellation policy"
          value={values.cancellation_policy}
          onChangeText={(text) => set('cancellation_policy', text)}
          error={errors.cancellation_policy}
          multiline
          numberOfLines={3}
          maxLength={2000}
        />
      </FormSection>

      <FormSection title="Price options" description="Each option is priced per unit: a person, a couple, a group.">
        <OptionsEditor options={values.options} onChange={(options) => set('options', options)} />
        <FormError message={errors.options} />
      </FormSection>

      <FormSection title="What's included">
        <LinesEditor
          label="Included"
          lines={values.included}
          onChange={(lines) => set('included', lines)}
          maxLines={MAX_LINES}
          maxLength={200}
          error={errors.included}
        />
        <LinesEditor
          label="Not included"
          lines={values.not_included}
          onChange={(lines) => set('not_included', lines)}
          maxLines={MAX_LINES}
          maxLength={200}
          error={errors.not_included}
        />
      </FormSection>

      <FormSection title="Photos" description="PNG, JPEG or WebP up to 2 MB, at most 8. The first is the cover.">
        {tour ? (
          <SavedPhotos
            path={`/admin/tours/${tour.id}/photos`}
            initial={tour.photos}
            max={MAX_PHOTOS}
            queryKey={['admin', 'tours']}
          />
        ) : (
          <PendingPhotos files={pending} onChange={setPending} max={MAX_PHOTOS} noun="tour" />
        )}
      </FormSection>

      <FormError message={formError} />
      <FormFooter>
        <Button title="Cancel" variant="secondary" onPress={onCancel} disabled={saving} />
        <Button title={tour ? 'Save changes' : 'Create tour'} onPress={submit} loading={saving && !askNotice} />
      </FormFooter>

      {askNotice && tour ? (
        <NoticeDialog tour={tour} saving={saving} onSave={save} onClose={() => setAskNotice(false)} />
      ) : null}
    </>
  );
}

function NoticeDialog({
  tour,
  saving,
  onSave,
  onClose,
}: {
  tour: AdminTour;
  saving: boolean;
  onSave: (notice?: string) => void;
  onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | undefined>();
  const bookings = `${tour.confirmed_bookings} booking${tour.confirmed_bookings === 1 ? '' : 's'}`;
  return (
    <Dialog
      open
      title="Tell the customers?"
      size="large"
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <Button title="Save without notifying" variant="secondary" onPress={() => onSave()} disabled={saving} />
          <Button
            title="Save and notify"
            loading={saving}
            onPress={() => {
              if (!message.trim()) {
                setError('Write the message to send.');
                return;
              }
              onSave(message.trim());
            }}
          />
        </>
      }
    >
      <Text style={styles.text}>
        {bookings} ({peopleLabel(tour.booked)}) are booked on this tour. Tell them about the change?
      </Text>
      <TextField
        label="Message to the customers"
        placeholder="e.g. We now meet at the Hilton at 7:00."
        value={message}
        onChangeText={(text) => {
          setMessage(text);
          setError(undefined);
        }}
        error={error}
        multiline
        numberOfLines={4}
        maxLength={2000}
      />
    </Dialog>
  );
}

function OptionsEditor({ options, onChange }: { options: OptionDraft[]; onChange: (options: OptionDraft[]) => void }) {
  const update = (index: number, changes: Partial<OptionDraft>) =>
    onChange(options.map((option, other) => (other === index ? { ...option, ...changes } : option)));
  const move = (index: number, by: number) => {
    const next = [...options];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    onChange(next);
  };
  return (
    <View style={styles.list}>
      {options.map((option, index) => {
        const label = option.name.trim() || `Option ${index + 1}`;
        return (
          <View key={option.id ?? `new-${index}`} style={styles.item}>
            <View style={styles.between}>
              <View style={styles.row}>
                <Text style={styles.strong}>{label}</Text>
                {option.booked ? <StatusChip label={`${option.units_sold} sold`} tone="info" /> : null}
                {!option.is_active ? <StatusChip label="Inactive" tone="neutral" /> : null}
              </View>
              <View style={styles.row}>
                <Button title="Up" variant="link" disabled={index === 0} onPress={() => move(index, -1)} />
                <Button
                  title="Down"
                  variant="link"
                  disabled={index === options.length - 1}
                  onPress={() => move(index, 1)}
                />
                {!option.booked ? (
                  <Button
                    title="Delete"
                    variant="link"
                    onPress={() => onChange(options.filter((_, other) => other !== index))}
                  />
                ) : null}
              </View>
            </View>
            <FieldGrid>
              <TextField
                label="Name"
                accessibilityLabel={`Option ${index + 1} name`}
                placeholder="e.g. VIP, Child (3–11), Couple"
                value={option.name}
                onChangeText={(name) => update(index, { name })}
                maxLength={60}
              />
              <TextField
                label="Price (USD)"
                accessibilityLabel={`Option ${index + 1} price`}
                value={option.price}
                onChangeText={(price) => update(index, { price })}
                keyboardType="decimal-pad"
              />
              <TextField
                label="People per unit"
                accessibilityLabel={`Option ${index + 1} people per unit`}
                value={option.people_per_unit}
                onChangeText={(people_per_unit) => update(index, { people_per_unit })}
                keyboardType="number-pad"
              />
              <TextField
                label="Units available"
                accessibilityLabel={`Option ${index + 1} units available`}
                placeholder="No limit"
                value={option.units_available}
                onChangeText={(units_available) => update(index, { units_available })}
                keyboardType="number-pad"
              />
            </FieldGrid>
            <TextField
              label="Description (optional)"
              accessibilityLabel={`Option ${index + 1} description`}
              value={option.description}
              onChangeText={(description) => update(index, { description })}
              maxLength={200}
            />
            <Toggle
              label={option.is_active ? 'Offered' : 'Not offered'}
              value={option.is_active}
              onChange={(is_active) => update(index, { is_active })}
            />
          </View>
        );
      })}
      <View style={styles.start}>
        <Button title="Add option" icon="add" variant="secondary" onPress={() => onChange([...options, newOption()])} />
      </View>
    </View>
  );
}

const styles = createStyles(() => ({
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
  text: { fontSize: font.body, color: colors.text },
  strong: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  muted: { fontSize: font.small, color: colors.muted },
  list: { gap: space.md },
  item: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  start: { alignSelf: 'flex-start' },
}));
