import { useEffect } from 'react';
import { Control, Controller, useFieldArray, useFormState, useWatch } from 'react-hook-form';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Direction } from '../../api/types';
import { AirlinePicker } from '../../components/AirlinePicker';
import { AirportPicker } from '../../components/AirportPicker';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { FieldGrid } from '../../components/Field';
import { Flag } from '../../components/Flag';
import { Icon, IconName } from '../../components/Icon';
import { DIRECTION_LABELS } from '../../components/Itinerary';
import { PressState } from '../../components/pressState';
import { TONES } from '../../components/StatusChip';
import { TextField } from '../../components/TextField';
import { TimeField } from '../../components/TimeField';
import { colors, font, radius, space, weight } from '../../theme';
import { formatDuration } from '../../utils/format';
import { ItineraryFormValues, MAX_FLIGHTS, SegmentFormValues, newSegment } from './offerSchema';

/** Any form with an itinerary, such as the offer form or the confirm availability dialog. */
type ItineraryForm = { segments: ItineraryFormValues };

const STOPOVER_MINUTES = 24 * 60;

type Props<T extends ItineraryForm> = { control: Control<T>; direction: Direction };

/**
 * One direction's flights: add a connecting flight, remove and reorder, with the connections shown live.
 * A connecting flight starts where the one before it lands; the first return flight goes back the way the trip came.
 */
export function SegmentFields<T extends ItineraryForm>({ control: formControl, direction }: Props<T>) {
  // Only the itinerary part of the form is used here.
  const control = formControl as unknown as Control<ItineraryForm>;
  const { fields, append, remove, move } = useFieldArray({ control, name: `segments.${direction}` });
  const flights = useWatch({ control, name: `segments.${direction}` }) ?? [];
  const outbound = useWatch({ control, name: 'segments.outbound' }) ?? [];
  const { errors } = useFormState({ control, name: `segments.${direction}` });
  const listError = errors.segments?.[direction]?.message ?? errors.segments?.[direction]?.root?.message;
  const label = DIRECTION_LABELS[direction];

  useEffect(() => {
    if (direction === 'return' && fields.length === 0) {
      const first = outbound[0];
      const last = outbound[outbound.length - 1];
      append(
        newSegment({
          origin: last?.destination ?? null,
          destination: first?.origin ?? null,
          airline: last?.airline ?? null,
        }),
      );
    }
    // Only when the return section first appears empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addConnecting = () => {
    const last = flights[flights.length - 1];
    const end = direction === 'return' ? outbound[0]?.origin : null;
    append(
      newSegment({
        airline: last?.airline ?? null,
        origin: last?.destination ?? null,
        destination: end ?? null,
        departure_date: last?.arrival_date ?? '',
        arrival_date: last?.arrival_date ?? '',
      }),
    );
  };

  return (
    <View style={styles.editor}>
      {fields.map((field, index) => {
        const name = `${label} flight ${index + 1}`;
        return (
          <View key={field.id} style={styles.group}>
            {index > 0 ? <ConnectionPreview previous={flights[index - 1]} next={flights[index]} /> : null}
            <View style={styles.segment}>
              <View style={styles.header}>
                <Text style={styles.title}>Flight {index + 1}</Text>
                <View style={styles.controls}>
                  <IconButton
                    icon="arrow-up"
                    label={`Move ${name} up`}
                    disabled={index === 0}
                    onPress={() => move(index, index - 1)}
                  />
                  <IconButton
                    icon="arrow-down"
                    label={`Move ${name} down`}
                    disabled={index === fields.length - 1}
                    onPress={() => move(index, index + 1)}
                  />
                  <IconButton
                    icon="trash-outline"
                    label={`Remove ${name}`}
                    disabled={fields.length === 1}
                    onPress={() => remove(index)}
                  />
                </View>
              </View>
              <FieldGrid>
                <Controller
                  control={control}
                  name={`segments.${direction}.${index}.airline`}
                  render={({ field: input, fieldState }) => (
                    <AirlinePicker
                      label="Airline"
                      accessibilityLabel={`${name} airline`}
                      value={input.value}
                      onChange={input.onChange}
                      error={fieldState.error?.message}
                    />
                  )}
                />
                <Controller
                  control={control}
                  name={`segments.${direction}.${index}.flight_number`}
                  render={({ field: input, fieldState }) => (
                    <TextField
                      label="Flight number"
                      accessibilityLabel={`${name} number`}
                      placeholder="e.g. 310"
                      value={input.value}
                      onChangeText={input.onChange}
                      onBlur={input.onBlur}
                      error={fieldState.error?.message}
                      autoCapitalize="characters"
                      maxLength={5}
                    />
                  )}
                />
                <Controller
                  control={control}
                  name={`segments.${direction}.${index}.operating_airline`}
                  render={({ field: input, fieldState }) => (
                    <AirlinePicker
                      label="Operated by (optional)"
                      accessibilityLabel={`${name} operated by`}
                      value={input.value}
                      onChange={input.onChange}
                      error={fieldState.error?.message}
                    />
                  )}
                />
              </FieldGrid>
              <FieldGrid columns={2}>
                {(['origin', 'destination'] as const).map((part) => (
                  <Controller
                    key={part}
                    control={control}
                    name={`segments.${direction}.${index}.${part}`}
                    render={({ field: input, fieldState }) => (
                      <AirportPicker
                        label={part === 'origin' ? 'From' : 'To'}
                        accessibilityLabel={`${name} ${part === 'origin' ? 'from' : 'to'}`}
                        value={input.value}
                        onChange={input.onChange}
                        error={fieldState.error?.message}
                      />
                    )}
                  />
                ))}
              </FieldGrid>
              <FieldGrid>
                {(['departure', 'arrival'] as const).flatMap((part) => [
                  <Controller
                    key={`${part}_date`}
                    control={control}
                    name={`segments.${direction}.${index}.${part}_date`}
                    render={({ field: input, fieldState }) => (
                      <DateField
                        label={part === 'departure' ? 'Departure date' : 'Arrival date'}
                        accessibilityLabel={`${name} ${part} date`}
                        value={input.value}
                        onChange={input.onChange}
                        error={fieldState.error?.message}
                      />
                    )}
                  />,
                  <Controller
                    key={`${part}_time`}
                    control={control}
                    name={`segments.${direction}.${index}.${part}_time`}
                    render={({ field: input, fieldState }) => (
                      <TimeField
                        label={part === 'departure' ? 'Departs (local)' : 'Arrives (local)'}
                        accessibilityLabel={`${name} ${part} time`}
                        value={input.value}
                        onChange={input.onChange}
                        error={fieldState.error?.message}
                      />
                    )}
                  />,
                ])}
              </FieldGrid>
            </View>
          </View>
        );
      })}
      {listError ? <Text style={styles.error}>{listError}</Text> : null}
      <View style={styles.add}>
        <Button
          title={fields.length >= MAX_FLIGHTS ? `At most ${MAX_FLIGHTS} flights` : 'Add connecting flight'}
          icon="add"
          variant="secondary"
          disabled={fields.length >= MAX_FLIGHTS}
          onPress={addConnecting}
        />
      </View>
    </View>
  );
}

/** The wait between two flights as typed so far, with its Layover or Stopover tag. */
function ConnectionPreview({ previous, next }: { previous?: SegmentFormValues; next?: SegmentFormValues }) {
  if (!previous?.arrival_date || !previous.arrival_time || !next?.departure_date || !next.departure_time) {
    return null;
  }
  // Both times are local to the connection airport, so the difference is the wait.
  const minutes =
    (Date.parse(`${next.departure_date}T${next.departure_time}:00Z`) -
      Date.parse(`${previous.arrival_date}T${previous.arrival_time}:00Z`)) /
    60_000;
  if (Number.isNaN(minutes)) {
    return null;
  }
  const airport = previous.destination;
  if (minutes <= 0) {
    return <Text style={styles.error}>This flight leaves before the previous one lands.</Text>;
  }
  const stopover = minutes >= STOPOVER_MINUTES;
  const tone = stopover ? TONES.warning : TONES.info;
  return (
    <View style={styles.connection}>
      {airport ? <Flag code={airport.country_code} /> : null}
      <Text style={styles.connectionText}>
        {formatDuration(minutes)}
        {airport ? ` in ${airport.city} (${airport.code})` : ''}
      </Text>
      <View style={[styles.tag, { backgroundColor: tone.background }]}>
        <Text style={[styles.tagText, { color: tone.color }]}>{stopover ? 'Stopover' : 'Layover'}</Text>
      </View>
    </View>
  );
}

type IconButtonProps = { icon: IconName; label: string; onPress: () => void; disabled?: boolean };

function IconButton({ icon, label, onPress, disabled }: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ hovered, pressed }: PressState) => [
        styles.iconButton,
        !disabled && (hovered || pressed) && styles.iconButtonHovered,
        disabled && styles.iconButtonDisabled,
      ]}
    >
      <Icon name={icon} size={18} color={colors.tertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  editor: { gap: space.md },
  group: { gap: space.md },
  segment: {
    gap: space.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  controls: { flexDirection: 'row', gap: space.xs, marginLeft: 'auto' },
  connection: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  connectionText: { flexShrink: 1, fontSize: font.small, color: colors.text },
  tag: { borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 10 },
  tagText: { fontSize: font.caption, fontWeight: weight.bold },
  error: { color: colors.dangerText, fontSize: font.small },
  add: { alignItems: 'flex-start' },
  iconButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconButtonHovered: { backgroundColor: colors.neutralTint },
  iconButtonDisabled: { opacity: 0.4 },
});
