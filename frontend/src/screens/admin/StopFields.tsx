import { Control, Controller, useFieldArray, useFormState, useWatch } from 'react-hook-form';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AirportPicker } from '../../components/AirportPicker';
import { Button } from '../../components/Button';
import { Icon, IconName } from '../../components/Icon';
import { PressState } from '../../components/pressState';
import { TONES } from '../../components/StatusChip';
import { TextField } from '../../components/TextField';
import { colors, font, radius, space, weight } from '../../theme';
import { EMPTY_STOP, MAX_STOPS, OfferFormValues, stopMinutes } from './offerSchema';

const STOPOVER_MINUTES = 24 * 60;

/** The stop editor: add, remove and reorder stops, each with an airport and a duration in hours and minutes. */
export function StopFields({ control }: { control: Control<OfferFormValues> }) {
  const { fields, append, remove, move } = useFieldArray({ control, name: 'stops' });
  const { errors } = useFormState({ control, name: 'stops' });
  const listError = errors.stops?.message ?? errors.stops?.root?.message;

  return (
    <View style={styles.editor}>
      {fields.length === 0 ? <Text style={styles.muted}>Direct flight. Add a stop if the flight has one.</Text> : null}
      {fields.map((field, index) => (
        <View key={field.id} style={styles.stop}>
          <View style={styles.header}>
            <Text style={styles.title}>Stop {index + 1}</Text>
            <KindTag control={control} index={index} />
            <View style={styles.controls}>
              <IconButton
                icon="arrow-up"
                label={`Move stop ${index + 1} up`}
                disabled={index === 0}
                onPress={() => move(index, index - 1)}
              />
              <IconButton
                icon="arrow-down"
                label={`Move stop ${index + 1} down`}
                disabled={index === fields.length - 1}
                onPress={() => move(index, index + 1)}
              />
              <IconButton icon="trash-outline" label={`Remove stop ${index + 1}`} onPress={() => remove(index)} />
            </View>
          </View>
          <View style={styles.fields}>
            <View style={styles.airport}>
              <Controller
                control={control}
                name={`stops.${index}.airport`}
                render={({ field: input, fieldState }) => (
                  <AirportPicker
                    label={`Stop ${index + 1} airport`}
                    value={input.value}
                    onChange={input.onChange}
                    error={fieldState.error?.message}
                  />
                )}
              />
            </View>
            <View style={styles.duration}>
              {(['hours', 'minutes'] as const).map((part) => (
                <View key={part} style={styles.part}>
                  <Controller
                    control={control}
                    name={`stops.${index}.${part}`}
                    render={({ field: input, fieldState }) => (
                      <TextField
                        label={part === 'hours' ? 'Hours' : 'Minutes'}
                        accessibilityLabel={`Stop ${index + 1} ${part}`}
                        value={input.value}
                        onChangeText={input.onChange}
                        onBlur={input.onBlur}
                        error={fieldState.error?.message}
                        keyboardType="number-pad"
                        placeholder="0"
                      />
                    )}
                  />
                </View>
              ))}
            </View>
          </View>
        </View>
      ))}
      {listError ? <Text style={styles.error}>{listError}</Text> : null}
      <View style={styles.add}>
        <Button
          title={fields.length >= MAX_STOPS ? `At most ${MAX_STOPS} stops` : 'Add a stop'}
          icon="add"
          variant="secondary"
          disabled={fields.length >= MAX_STOPS}
          onPress={() => append({ ...EMPTY_STOP })}
        />
      </View>
    </View>
  );
}

/** Layover or Stopover, from the duration typed so far. */
function KindTag({ control, index }: { control: Control<OfferFormValues>; index: number }) {
  const stop = useWatch({ control, name: `stops.${index}` });
  const minutes = stop ? stopMinutes(stop) : 0;
  if (!(minutes > 0)) {
    return null;
  }
  const stopover = minutes >= STOPOVER_MINUTES;
  const tone = stopover ? TONES.warning : TONES.info;
  return (
    <View style={[styles.tag, { backgroundColor: tone.background }]}>
      <Text style={[styles.tagText, { color: tone.color }]}>{stopover ? 'Stopover' : 'Layover'}</Text>
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
  muted: { color: colors.muted, fontSize: font.small },
  stop: {
    gap: space.sm,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { fontSize: font.body, fontWeight: weight.bold, color: colors.text },
  controls: { flexDirection: 'row', gap: space.xs, marginLeft: 'auto' },
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  airport: { flexGrow: 2, flexBasis: 240, minWidth: 0 },
  duration: { flexGrow: 1, flexBasis: 160, flexDirection: 'row', gap: space.sm },
  part: { flex: 1, minWidth: 0 },
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
