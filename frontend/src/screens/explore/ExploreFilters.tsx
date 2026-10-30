import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { OfferFilterErrors, OfferFilterValues } from '../../components/OfferFilterFields';
import { OptionChips } from '../../components/OptionChips';
import { TextField } from '../../components/TextField';
import { colors, font, space, weight } from '../../theme';

const STOPOVER_OPTIONS = [
  { value: '', label: 'Any' },
  { value: '0', label: 'Direct' },
  { value: '1', label: 'Up to 1' },
  { value: '2', label: 'Up to 2' },
];

type Props = {
  value: OfferFilterValues;
  onChange: (value: OfferFilterValues) => void;
  errors: OfferFilterErrors;
  /** Applies the price and stopover filters in `next`. */
  onApply: (next: OfferFilterValues) => void;
  onClear: () => void;
};

/** Price and stopover filters. Chips apply at once; prices on Enter or when leaving the field. */
export function ExploreFilters({ value, onChange, errors, onApply, onClear }: Props) {
  const priceField = (name: 'price_min' | 'price_max', label: string) => (
    <View style={styles.price}>
      <TextField
        label={label}
        value={value[name]}
        onChangeText={(text) => onChange({ ...value, [name]: text })}
        onSubmitEditing={() => onApply(value)}
        onBlur={() => onApply(value)}
        error={errors[name]}
        keyboardType="decimal-pad"
        placeholder={name === 'price_min' ? '0' : 'Any'}
      />
    </View>
  );

  return (
    <View style={styles.box}>
      <View style={styles.header}>
        <Text style={styles.title}>Filters</Text>
        <Button title="Clear all" variant="link" onPress={onClear} />
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Price per person (USD)</Text>
        <View style={styles.prices}>
          {priceField('price_min', 'Min price (USD)')}
          {priceField('price_max', 'Max price (USD)')}
        </View>
      </View>
      <OptionChips
        label="Max stopovers"
        options={STOPOVER_OPTIONS}
        value={value.max_stopovers}
        onChange={(max_stopovers) => {
          const next = { ...value, max_stopovers };
          onChange(next);
          onApply(next);
        }}
        error={errors.max_stopovers}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  section: { gap: space.sm },
  sectionTitle: { fontSize: font.small, fontWeight: weight.bold, color: colors.text },
  prices: { flexDirection: 'row', gap: space.sm },
  price: { flex: 1, minWidth: 0 },
});
