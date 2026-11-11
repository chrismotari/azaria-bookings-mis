import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { api } from '../../api/client';
import { applyServerErrors } from '../../api/errors';
import {
  Airline,
  Airport,
  Integration,
  Route,
  RouteSchedule,
  TICKET_CLASSES,
  TicketClass,
  TripType,
} from '../../api/types';
import { AirlineBadge } from '../../components/AirlineBadge';
import { AirlinePicker } from '../../components/AirlinePicker';
import { AirportPicker } from '../../components/AirportPicker';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { Field, FieldGrid, FormError } from '../../components/Field';
import { FormSection } from '../../components/FormSection';
import { PressState } from '../../components/pressState';
import { SegmentedControl } from '../../components/SegmentedControl';
import { SelectField } from '../../components/SelectField';
import { TextField } from '../../components/TextField';
import { Toggle } from '../../components/Toggle';
import { colors, font, radius, space, weight } from '../../theme';
import { FARES_KEY, ROUTES_KEY, SCHEDULES, WEEKDAYS } from './gds';

const TRIP_TYPES: { value: TripType; label: string }[] = [
  { value: 'one_way', label: 'One way' },
  { value: 'return', label: 'Return' },
];

const CONNECTIONS = [
  { value: '', label: 'Any' },
  { value: '0', label: 'Direct only' },
  ...[1, 2, 3, 4].map((count) => ({ value: String(count), label: `Up to ${count}` })),
];

const PER_DATE = [1, 2, 3, 4, 5].map((count) => ({ value: String(count), label: String(count) }));

const MONEY = /^\d{1,7}(\.\d{1,2})?$/;

const WINDOWS: { value: Route['window']; label: string }[] = [
  { value: 'rolling', label: 'Days ahead' },
  { value: 'fixed', label: 'Fixed dates' },
];

const WEEKDAY_OPTIONS = WEEKDAYS.map((label, value) => ({ value: String(value), label }));

/** The longest window, as the server allows it: fixed dates count both ends, days ahead their difference. */
const MAX_WINDOW_DAYS = 60;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Mirrors the server's rules.
const schema = z
  .object({
    origin: z.custom<Airport | null>(),
    destination: z.custom<Airport | null>(),
    trip_type: z.enum(['one_way', 'return']),
    stay_nights: z.string().trim(),
    ticket_class: z.enum(['economy', 'premium_economy', 'business', 'first']),
    max_connections: z.string(),
    airlines: z.array(z.custom<Airline>()),
    integrations: z.array(z.string()),
    weekdays: z.array(z.number()),
    pick_cheapest: z.boolean(),
    pick_cheapest_direct: z.boolean(),
    max_per_date: z.string(),
    markup_percent: z
      .string()
      .trim()
      .regex(/^\d{1,4}(\.\d{1,2})?$/, 'Enter a percentage, e.g. 5 or 7.5.'),
    markup_fixed: z.string().trim().regex(MONEY, 'Enter an amount in USD, e.g. 20 or 12.50.'),
    schedule: z.enum(['manual', 'daily', 'weekly']),
    schedule_weekday: z.string(),
    window: z.enum(['fixed', 'rolling']),
    window_from: z.string(),
    window_to: z.string(),
    days_ahead_from: z.string().trim(),
    days_ahead_to: z.string().trim(),
    auto_publish: z.boolean(),
    is_active: z.boolean(),
  })
  .superRefine((values, ctx) => {
    if (!values.origin) {
      ctx.addIssue({ code: 'custom', path: ['origin'], message: 'Choose where the route starts.' });
    }
    if (!values.destination) {
      ctx.addIssue({ code: 'custom', path: ['destination'], message: 'Choose where the route goes.' });
    } else if (values.origin && values.origin.code === values.destination.code) {
      ctx.addIssue({ code: 'custom', path: ['destination'], message: 'From and To must differ.' });
    }
    if (values.trip_type === 'return') {
      const nights = Number(values.stay_nights);
      if (!/^\d+$/.test(values.stay_nights) || nights < 1 || nights > 60) {
        ctx.addIssue({ code: 'custom', path: ['stay_nights'], message: 'Enter 1 to 60 nights.' });
      }
    }
    if (!values.pick_cheapest && !values.pick_cheapest_direct) {
      ctx.addIssue({ code: 'custom', path: ['pick_cheapest'], message: 'Choose at least one pick rule.' });
    }
    if (values.window === 'fixed') {
      if (!ISO_DATE.test(values.window_from)) {
        ctx.addIssue({ code: 'custom', path: ['window_from'], message: 'Choose the first departure date.' });
      } else if (!ISO_DATE.test(values.window_to)) {
        ctx.addIssue({ code: 'custom', path: ['window_to'], message: 'Choose the last departure date.' });
      } else if (values.window_to < values.window_from) {
        ctx.addIssue({
          code: 'custom',
          path: ['window_to'],
          message: 'The last departure date must be on or after the first.',
        });
      } else if ((Date.parse(values.window_to) - Date.parse(values.window_from)) / 86_400_000 + 1 > MAX_WINDOW_DAYS) {
        ctx.addIssue({
          code: 'custom',
          path: ['window_to'],
          message: `Search at most ${MAX_WINDOW_DAYS} days at a time.`,
        });
      }
    } else {
      const from = Number(values.days_ahead_from);
      const to = Number(values.days_ahead_to);
      if (!/^\d+$/.test(values.days_ahead_from)) {
        ctx.addIssue({ code: 'custom', path: ['days_ahead_from'], message: 'Enter a number of days (0 is today).' });
      } else if (!/^\d+$/.test(values.days_ahead_to)) {
        ctx.addIssue({ code: 'custom', path: ['days_ahead_to'], message: 'Enter a number of days.' });
      } else if (to < from) {
        ctx.addIssue({
          code: 'custom',
          path: ['days_ahead_to'],
          message: 'The window must end on or after its start.',
        });
      } else if (to - from > MAX_WINDOW_DAYS) {
        ctx.addIssue({
          code: 'custom',
          path: ['days_ahead_to'],
          message: `The window can span at most ${MAX_WINDOW_DAYS} days.`,
        });
      }
    }
  });

type FormValues = z.infer<typeof schema>;

const FIELDS = [
  'origin',
  'destination',
  'trip_type',
  'stay_nights',
  'ticket_class',
  'max_connections',
  'airlines',
  'integrations',
  'weekdays',
  'pick_cheapest',
  'max_per_date',
  'markup_percent',
  'markup_fixed',
  'schedule_weekday',
  'window_from',
  'window_to',
  'days_ahead_from',
  'days_ahead_to',
] as const;

function toValues(route?: Route): FormValues {
  return {
    origin: route?.origin ?? null,
    destination: route?.destination ?? null,
    trip_type: route?.trip_type ?? 'one_way',
    stay_nights: route?.stay_nights ? String(route.stay_nights) : '7',
    ticket_class: route?.ticket_class ?? 'economy',
    max_connections: route?.max_connections === null || !route ? '' : String(route.max_connections),
    airlines: route?.airlines ?? [],
    integrations: route?.integrations.map((integration) => integration.id) ?? [],
    weekdays: route?.weekdays ?? [],
    pick_cheapest: route?.pick_cheapest ?? true,
    pick_cheapest_direct: route?.pick_cheapest_direct ?? false,
    max_per_date: String(route?.max_per_date ?? 1),
    markup_percent: route ? String(Number(route.markup_percent)) : '0',
    markup_fixed: route ? String(Number(route.markup_fixed)) : '0',
    schedule: route?.schedule ?? 'manual',
    schedule_weekday: String(route?.schedule_weekday ?? 0),
    window: route?.window ?? 'rolling',
    window_from: route?.window_from ?? '',
    window_to: route?.window_to ?? '',
    days_ahead_from: String(route?.days_ahead_from ?? 1),
    days_ahead_to: String(route?.days_ahead_to ?? 30),
    auto_publish: route?.auto_publish ?? false,
    is_active: route?.is_active ?? true,
  };
}

type Props = {
  /** Edits this route; creates one without it. */
  route?: Route;
  integrations: Integration[];
  onSaved: (route: Route) => void;
  onCancel?: () => void;
};

export function RouteForm({ route, integrations, onSaved, onCancel }: Props) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { control, handleSubmit, setError, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: toValues(route),
  });
  const tripType = useWatch({ control, name: 'trip_type' });
  const schedule = useWatch({ control, name: 'schedule' });
  const windowKind = useWatch({ control, name: 'window' });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setSaved(false);
    const body = {
      origin: values.origin?.code,
      destination: values.destination?.code,
      trip_type: values.trip_type,
      stay_nights: values.trip_type === 'return' ? Number(values.stay_nights) : null,
      ticket_class: values.ticket_class,
      max_connections: values.max_connections === '' ? null : Number(values.max_connections),
      airlines: values.airlines.map((airline) => airline.id),
      integrations: values.integrations,
      weekdays: values.weekdays,
      pick_cheapest: values.pick_cheapest,
      pick_cheapest_direct: values.pick_cheapest_direct,
      max_per_date: Number(values.max_per_date),
      markup_percent: values.markup_percent.trim(),
      markup_fixed: values.markup_fixed.trim(),
      schedule: values.schedule,
      schedule_weekday: values.schedule === 'weekly' ? Number(values.schedule_weekday) : null,
      window: values.window,
      ...(values.window === 'fixed'
        ? { window_from: values.window_from, window_to: values.window_to }
        : { days_ahead_from: Number(values.days_ahead_from), days_ahead_to: Number(values.days_ahead_to) }),
      auto_publish: values.auto_publish,
      is_active: values.is_active,
    };
    try {
      const { data } = route
        ? await api.patch<Route>(`/admin/routes/${route.id}`, body)
        : await api.post<Route>('/admin/routes', body);
      reset(toValues(data));
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ROUTES_KEY });
      await queryClient.invalidateQueries({ queryKey: FARES_KEY });
      onSaved(data);
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS));
    }
  });

  return (
    <View style={styles.form}>
      <FormSection title="Route" plain>
        <FieldGrid columns={2}>
          {(['origin', 'destination'] as const).map((part) => (
            <Controller
              key={part}
              control={control}
              name={part}
              render={({ field, fieldState }) => (
                <AirportPicker
                  label={part === 'origin' ? 'From' : 'To'}
                  value={field.value}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                />
              )}
            />
          ))}
        </FieldGrid>
        <FieldGrid columns={2}>
          <Controller
            control={control}
            name="trip_type"
            render={({ field }) => (
              <Field label="Trip">
                <SegmentedControl label="Trip" options={TRIP_TYPES} value={field.value} onChange={field.onChange} />
              </Field>
            )}
          />
          {tripType === 'return' ? (
            <Controller
              control={control}
              name="stay_nights"
              render={({ field, fieldState }) => (
                <TextField
                  label="Nights before returning"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                  keyboardType="number-pad"
                />
              )}
            />
          ) : null}
        </FieldGrid>
        <FieldGrid columns={2}>
          <Controller
            control={control}
            name="ticket_class"
            render={({ field }) => (
              <SelectField<TicketClass>
                label="Cabin"
                options={TICKET_CLASSES}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={control}
            name="max_connections"
            render={({ field }) => (
              <SelectField
                label="Connections per direction"
                options={CONNECTIONS}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </FieldGrid>
        <Controller
          control={control}
          name="weekdays"
          render={({ field }) => (
            <Field label="Departure days (none chosen: every day)">
              <ToggleChips
                options={WEEKDAYS.map((label, value) => ({ value, label }))}
                value={field.value}
                onChange={field.onChange}
              />
            </Field>
          )}
        />
      </FormSection>

      <FormSection
        title="Dates and schedule"
        description="The departure dates each search covers, and when the route is searched on its own (from 02:00 Nairobi time)."
        plain
      >
        <Controller
          control={control}
          name="window"
          render={({ field }) => (
            <Field label="Departures">
              <SegmentedControl label="Departures" options={WINDOWS} value={field.value} onChange={field.onChange} />
            </Field>
          )}
        />
        {windowKind === 'fixed' ? (
          <FieldGrid columns={2}>
            {(['window_from', 'window_to'] as const).map((part) => (
              <Controller
                key={part}
                control={control}
                name={part}
                render={({ field, fieldState }) => (
                  <DateField
                    label={part === 'window_from' ? 'First departure' : 'Last departure'}
                    value={field.value}
                    onChange={field.onChange}
                    error={fieldState.error?.message}
                  />
                )}
              />
            ))}
          </FieldGrid>
        ) : (
          <FieldGrid columns={2}>
            {(['days_ahead_from', 'days_ahead_to'] as const).map((part) => (
              <Controller
                key={part}
                control={control}
                name={part}
                render={({ field, fieldState }) => (
                  <TextField
                    label={part === 'days_ahead_from' ? 'From (days ahead)' : 'To (days ahead)'}
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    error={fieldState.error?.message}
                    keyboardType="number-pad"
                  />
                )}
              />
            ))}
          </FieldGrid>
        )}
        <FieldGrid columns={2}>
          <Controller
            control={control}
            name="schedule"
            render={({ field }) => (
              <Field label="Scheduled search">
                <SegmentedControl<RouteSchedule>
                  label="Scheduled search"
                  options={SCHEDULES}
                  value={field.value}
                  onChange={field.onChange}
                />
              </Field>
            )}
          />
          {schedule === 'weekly' ? (
            <Controller
              control={control}
              name="schedule_weekday"
              render={({ field }) => (
                <SelectField label="On" options={WEEKDAY_OPTIONS} value={field.value} onChange={field.onChange} />
              )}
            />
          ) : null}
        </FieldGrid>
        <Controller
          control={control}
          name="auto_publish"
          render={({ field }) => (
            <Field label="Publishing">
              <Toggle
                label={
                  field.value
                    ? 'Publish picked fares automatically; offers no longer found are deactivated'
                    : 'Review picked fares before publishing; offers no longer found are flagged'
                }
                value={field.value}
                onChange={field.onChange}
              />
            </Field>
          )}
        />
      </FormSection>

      <FormSection
        title="Airlines and integrations"
        description="Leave airlines empty for any ticketing airline, and integrations empty to search every active one."
        plain
      >
        <Controller
          control={control}
          name="airlines"
          render={({ field }) => <AirlineList value={field.value} onChange={field.onChange} />}
        />
        {integrations.length > 0 ? (
          <Controller
            control={control}
            name="integrations"
            render={({ field }) => (
              <Field label="Integrations">
                <ToggleChips
                  options={integrations.map((integration) => ({
                    value: integration.id,
                    label: integration.is_active ? integration.name : `${integration.name} (disabled)`,
                  }))}
                  value={field.value}
                  onChange={field.onChange}
                />
              </Field>
            )}
          />
        ) : null}
      </FormSection>

      <FormSection
        title="Picking and markup"
        description="Per departure date, after removing duplicates. Selling price = net in USD × (1 + percent) + fixed amount."
        plain
      >
        <Controller
          control={control}
          name="pick_cheapest"
          render={({ field, fieldState }) => (
            <Field label="Pick" error={fieldState.error?.message}>
              <Toggle label="The cheapest fares" value={field.value} onChange={field.onChange} />
            </Field>
          )}
        />
        <Controller
          control={control}
          name="pick_cheapest_direct"
          render={({ field }) => (
            <Toggle label="The cheapest direct fare" value={field.value} onChange={field.onChange} />
          )}
        />
        <FieldGrid>
          <Controller
            control={control}
            name="max_per_date"
            render={({ field }) => (
              <SelectField
                label="Cheapest fares per date"
                options={PER_DATE}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={control}
            name="markup_percent"
            render={({ field, fieldState }) => (
              <TextField
                label="Markup (%)"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                keyboardType="decimal-pad"
              />
            )}
          />
          <Controller
            control={control}
            name="markup_fixed"
            render={({ field, fieldState }) => (
              <TextField
                label="Markup (USD)"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                keyboardType="decimal-pad"
              />
            )}
          />
        </FieldGrid>
        {route ? (
          <Controller
            control={control}
            name="is_active"
            render={({ field }) => (
              <Toggle
                label={field.value ? 'Active' : 'Inactive (not searched)'}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        ) : null}
      </FormSection>

      <FormError message={formError} />
      {saved && !formState.isDirty ? <Text style={styles.saved}>Route saved.</Text> : null}
      <View style={styles.buttons}>
        {onCancel ? (
          <Button title="Cancel" variant="secondary" onPress={onCancel} disabled={formState.isSubmitting} />
        ) : null}
        <Button
          title={route ? 'Save route' : 'Create route'}
          onPress={onSubmit}
          loading={formState.isSubmitting}
          disabled={route !== undefined && !formState.isDirty}
        />
      </View>
    </View>
  );
}

/** Several choices from a few options, as chips that toggle. */
function ToggleChips<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T[];
  onChange: (value: T[]) => void;
}) {
  return (
    <View style={styles.chips}>
      {options.map((option) => {
        const selected = value.includes(option.value);
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            onPress={() =>
              onChange(selected ? value.filter((item) => item !== option.value) : [...value, option.value])
            }
            style={({ hovered }: PressState) => [
              styles.chip,
              hovered && styles.chipHovered,
              selected && styles.chipSelected,
            ]}
          >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The chosen airlines, each removable, and a picker to add another. */
function AirlineList({ value, onChange }: { value: Airline[]; onChange: (value: Airline[]) => void }) {
  return (
    <View style={styles.airlines}>
      {value.map((airline) => (
        <View key={airline.id} style={styles.airline}>
          <AirlineBadge airline={airline} size={24} />
          <Text style={styles.airlineName} numberOfLines={1}>
            {airline.name} · {airline.iata_code}
          </Text>
          <Button
            title="Remove"
            variant="link"
            onPress={() => onChange(value.filter((item) => item.id !== airline.id))}
          />
        </View>
      ))}
      <AirlinePicker
        label={value.length ? 'Add another airline' : 'Ticketing airlines (any)'}
        value={null}
        onChange={(airline) => {
          if (airline && !value.some((item) => item.id === airline.id)) {
            onChange([...value, airline]);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.lg },
  saved: { color: colors.successText, fontWeight: weight.semibold },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  chipHovered: { borderColor: colors.primary },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: font.small, color: colors.text },
  chipTextSelected: { color: colors.primaryText },
  airlines: { gap: space.sm },
  airline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  airlineName: { flex: 1, minWidth: 0, color: colors.text },
});
