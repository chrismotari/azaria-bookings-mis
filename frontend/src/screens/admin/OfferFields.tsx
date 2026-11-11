import { Control, Controller, useFormState, useWatch } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { TICKET_CLASSES, TripType } from '../../api/types';
import { AirlinePicker } from '../../components/AirlinePicker';
import { DateField } from '../../components/DateField';
import { FieldGrid } from '../../components/Field';
import { FormSection } from '../../components/FormSection';
import { OptionChips } from '../../components/OptionChips';
import { SegmentedControl } from '../../components/SegmentedControl';
import { TextField } from '../../components/TextField';
import { Toggle } from '../../components/Toggle';
import { colors, font, space } from '../../theme';
import { POLICIES } from '../../utils/format';
import { OfferFormValues } from './offerSchema';
import { SegmentFields } from './SegmentFields';

const TRIP_TYPES: { value: TripType; label: string }[] = [
  { value: 'one_way', label: 'One way' },
  { value: 'return', label: 'Return' },
];

const BAG_COUNTS = ['0', '1', '2', '3'].map((value) => ({ value, label: value === '0' ? 'None' : value }));

type Props = {
  control: Control<OfferFormValues>;
  /** False for offers that are always private (custom offers in a response). */
  showPublicToggle?: boolean;
  /** Draws the sections without their own cards, for use inside another card. */
  plain?: boolean;
};

/** The offer fields shared by the create/edit form and the custom offers of Respond and Mark unavailable. */
export function OfferFields({ control, showPublicToggle = true, plain }: Props) {
  const tripType = useWatch({ control, name: 'trip_type' });
  const checkedBags = useWatch({ control, name: 'checked_bags' });
  const { errors } = useFormState({ control, name: 'segments' });
  // Itinerary rules the server reports for the whole list rather than one field.
  const itineraryError = errors.segments?.message;

  return (
    <>
      <FormSection title="Trip" plain={plain}>
        <Controller
          control={control}
          name="trip_type"
          render={({ field }) => (
            <View style={styles.trip}>
              <SegmentedControl label="Trip type" options={TRIP_TYPES} value={field.value} onChange={field.onChange} />
            </View>
          )}
        />
        {itineraryError ? <Text style={styles.error}>{itineraryError}</Text> : null}
      </FormSection>
      <FormSection
        title="Outbound flights"
        description="In flight order, with each airport's local times as printed on the ticket."
        plain={plain}
      >
        <SegmentFields control={control} direction="outbound" />
      </FormSection>
      {tripType === 'return' ? (
        <FormSection title="Return flights" description="Back from the destination to the origin." plain={plain}>
          <SegmentFields control={control} direction="return" />
        </FormSection>
      ) : null}
      <FormSection title="Baggage and fare conditions" description="Per passenger." plain={plain}>
        <Controller
          control={control}
          name="checked_bags"
          render={({ field, fieldState }) => (
            <OptionChips
              label="Checked bags"
              options={BAG_COUNTS}
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />
        <FieldGrid columns={2}>
          {checkedBags !== '0' ? (
            <Controller
              control={control}
              name="checked_bag_kg"
              render={({ field, fieldState }) => (
                <TextField
                  label="Weight per checked bag, kg (optional)"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                  keyboardType="number-pad"
                  placeholder="e.g. 23"
                />
              )}
            />
          ) : null}
          <Controller
            control={control}
            name="cabin_bag_kg"
            render={({ field, fieldState }) => (
              <TextField
                label="Cabin bag, kg (optional)"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                keyboardType="number-pad"
                placeholder="e.g. 7"
              />
            )}
          />
        </FieldGrid>
        {(['refund_policy', 'change_policy'] as const).map((name) => (
          <Controller
            key={name}
            control={control}
            name={name}
            render={({ field, fieldState }) => (
              <OptionChips
                label={name === 'refund_policy' ? 'Refunds' : 'Changes'}
                options={POLICIES}
                value={field.value}
                onChange={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
        ))}
      </FormSection>
      <FormSection title="Fare" plain={plain}>
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
                label="Ticketing airline"
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
                label={tripType === 'return' ? 'Return price per person (USD)' : 'Price per person (USD)'}
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
            name="valid_until"
            render={({ field, fieldState }) => (
              <DateField
                label="Valid until (inclusive)"
                value={field.value}
                onChange={field.onChange}
                error={fieldState.error?.message}
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
  trip: { maxWidth: 320 },
  toggle: { gap: space.xs },
  help: { color: colors.muted, fontSize: font.small },
  error: { color: colors.dangerText, fontSize: font.small },
});
