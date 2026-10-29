import { Control, Controller } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { TICKET_CLASSES } from '../../api/types';
import { AirportPicker } from '../../components/AirportPicker';
import { DateField } from '../../components/DateField';
import { FieldGrid } from '../../components/Field';
import { OptionChips } from '../../components/OptionChips';
import { TextField } from '../../components/TextField';
import { Toggle } from '../../components/Toggle';
import { colors } from '../../theme';
import { OfferingFormValues } from './offeringSchema';

type Props = {
  control: Control<OfferingFormValues>;
  /** False for offerings that are always private (custom offerings in a response). */
  showPublicToggle?: boolean;
};

/** The offering fields shared by the create/edit form and the respond screen. */
export function OfferingFields({ control, showPublicToggle = true }: Props) {
  return (
    <>
      <FieldGrid>
        {(['origin', 'destination'] as const).map((name) => (
          <Controller
            key={name}
            control={control}
            name={name}
            render={({ field, fieldState }) => (
              <AirportPicker
                label={name === 'origin' ? 'From' : 'To'}
                value={field.value}
                onChange={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
        ))}
      </FieldGrid>
      <FieldGrid>
        {(['departure_date', 'valid_until'] as const).map((name) => (
          <Controller
            key={name}
            control={control}
            name={name}
            render={({ field, fieldState }) => (
              <DateField
                label={name === 'departure_date' ? 'Departure date' : 'Valid until (inclusive)'}
                value={field.value}
                onChange={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
        ))}
      </FieldGrid>
      <Controller
        control={control}
        name="ticket_class"
        render={({ field, fieldState }) => (
          <OptionChips
            label="Class"
            options={TICKET_CLASSES}
            value={field.value}
            onChange={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <FieldGrid>
        <Controller
          control={control}
          name="airline"
          render={({ field, fieldState }) => (
            <TextField
              label="Airline"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="price"
          render={({ field, fieldState }) => (
            <TextField
              label="Price per person (USD)"
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
          name="stopovers"
          render={({ field, fieldState }) => (
            <TextField
              label="Stopovers"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              keyboardType="number-pad"
            />
          )}
        />
      </FieldGrid>
      {showPublicToggle ? (
        <Controller
          control={control}
          name="is_public"
          render={({ field }) => (
            <View style={styles.toggle}>
              <Toggle label="Public (listed in Explore)" value={field.value} onChange={field.onChange} />
              {!field.value ? (
                <Text style={styles.help}>Private offerings are only shown to customers you send them to.</Text>
              ) : null}
            </View>
          )}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  toggle: { gap: 4 },
  help: { color: colors.muted, fontSize: 13 },
});
