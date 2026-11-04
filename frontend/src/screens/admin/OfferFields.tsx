import { Control, Controller } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { TICKET_CLASSES } from '../../api/types';
import { AirlinePicker } from '../../components/AirlinePicker';
import { AirportPicker } from '../../components/AirportPicker';
import { DateField } from '../../components/DateField';
import { FieldGrid } from '../../components/Field';
import { FormSection } from '../../components/FormSection';
import { OptionChips } from '../../components/OptionChips';
import { TextField } from '../../components/TextField';
import { Toggle } from '../../components/Toggle';
import { colors, font } from '../../theme';
import { OfferFormValues } from './offerSchema';
import { StopFields } from './StopFields';

type Props = {
  control: Control<OfferFormValues>;
  /** False for offers that are always private (custom offers in a response). */
  showPublicToggle?: boolean;
  /** Draws the sections without their own cards, for use inside another card. */
  plain?: boolean;
};

/** The offer fields shared by the create/edit form and the respond screen, in titled sections. */
export function OfferFields({ control, showPublicToggle = true, plain }: Props) {
  return (
    <>
      <FormSection title="Route" plain={plain}>
        <FieldGrid columns={2}>
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
      </FormSection>
      <FormSection
        title="Stops"
        description="In flight order. Under 24 hours is a layover; 24 hours or more is a stopover."
        plain={plain}
      >
        <StopFields control={control} />
      </FormSection>
      <FormSection title="Dates" plain={plain}>
        <FieldGrid columns={2}>
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
      </FormSection>
      <FormSection title="Flight" plain={plain}>
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
        <FieldGrid columns={2}>
          <Controller
            control={control}
            name="airline"
            render={({ field, fieldState }) => (
              <AirlinePicker
                label="Airline"
                value={field.value}
                onChange={field.onChange}
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
        </FieldGrid>
      </FormSection>
      {showPublicToggle ? (
        <FormSection title="Visibility" plain={plain}>
          <Controller
            control={control}
            name="is_public"
            render={({ field }) => (
              <View style={styles.toggle}>
                <Toggle label="Public (listed in Explore)" value={field.value} onChange={field.onChange} />
                {!field.value ? (
                  <Text style={styles.help}>Private offers are only shown to customers you send them to.</Text>
                ) : null}
              </View>
            )}
          />
        </FormSection>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  toggle: { gap: 4 },
  help: { color: colors.muted, fontSize: font.small },
});
