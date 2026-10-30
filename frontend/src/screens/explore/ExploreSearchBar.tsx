import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TICKET_CLASSES, TicketClass } from '../../api/types';
import { AirportSearchField } from '../../components/AirportPicker';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { FieldGrid } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { OfferFilterErrors, OfferFilterValues } from '../../components/OfferFilterFields';
import { PressState } from '../../components/pressState';
import { SelectField } from '../../components/SelectField';
import { colors, font, radius, shadow, space, weight } from '../../theme';

const CLASS_OPTIONS: { value: '' | TicketClass; label: string }[] = [{ value: '', label: 'Any' }, ...TICKET_CLASSES];

type Props = {
  value: OfferFilterValues;
  onChange: (value: OfferFilterValues) => void;
  errors: OfferFilterErrors;
  onSearch: () => void;
  /** Stacks the fields for a narrow column. */
  compact: boolean;
};

/** Indigo band with the headline and the white search bar (route, dates, class). */
export function ExploreSearchBar({ value, onChange, errors, onSearch, compact }: Props) {
  const set = <K extends keyof OfferFilterValues>(key: K, fieldValue: OfferFilterValues[K]) =>
    onChange({ ...value, [key]: fieldValue });
  const swap = () => onChange({ ...value, origin: value.destination, destination: value.origin });

  const from = (
    <AirportSearchField label="From" value={value.origin} onChange={(q) => set('origin', q)} onSubmitEditing={onSearch} />
  );
  const to = (
    <AirportSearchField
      label="To"
      value={value.destination}
      onChange={(q) => set('destination', q)}
      onSubmitEditing={onSearch}
    />
  );
  const dateFrom = (
    <DateField label="Departing from" value={value.date_from} onChange={(d) => set('date_from', d)} error={errors.date_from} />
  );
  const dateTo = (
    <DateField label="Departing until" value={value.date_to} onChange={(d) => set('date_to', d)} error={errors.date_to} />
  );
  const ticketClass = (
    <SelectField label="Class" options={CLASS_OPTIONS} value={value.ticket_class} onChange={(c) => set('ticket_class', c)} />
  );
  const search = <Button title="Search" variant="accent" icon="search" onPress={onSearch} />;

  return (
    <View style={[styles.band, compact && styles.bandCompact]}>
      <View style={styles.inner}>
        <Text style={[styles.headline, compact && styles.headlineCompact]}>Find your next flight deal</Text>
        {compact ? (
          <View style={styles.bar}>
            {from}
            <View style={styles.swapRow}>
              <SwapButton onPress={swap} vertical />
            </View>
            {to}
            <FieldGrid>
              {dateFrom}
              {dateTo}
            </FieldGrid>
            {ticketClass}
            {search}
          </View>
        ) : (
          <View style={[styles.bar, styles.barRow]}>
            <View style={styles.airport}>{from}</View>
            <SwapButton onPress={swap} />
            <View style={styles.airport}>{to}</View>
            <View style={styles.date}>{dateFrom}</View>
            <View style={styles.date}>{dateTo}</View>
            <View style={styles.ticketClass}>{ticketClass}</View>
            {search}
          </View>
        )}
      </View>
    </View>
  );
}

function SwapButton({ onPress, vertical }: { onPress: () => void; vertical?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Swap From and To"
      onPress={onPress}
      style={({ hovered, focused }: PressState) => [
        styles.swap,
        hovered && styles.swapHovered,
        focused && styles.focused,
      ]}
    >
      <Icon name={vertical ? 'swap-vertical' : 'swap-horizontal'} size={18} color={colors.primary} />
    </Pressable>
  );
}

const SWAP = 36;

const styles = StyleSheet.create({
  band: { backgroundColor: colors.primary, paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.xxl },
  bandCompact: { paddingTop: space.lg, paddingBottom: space.xl },
  inner: { width: '100%', maxWidth: 1100, alignSelf: 'center', gap: space.lg },
  headline: { fontSize: font.display, fontWeight: weight.heavy, color: colors.primaryText },
  headlineCompact: { fontSize: font.title },
  bar: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
    ...shadow,
  },
  // Aligned on the inputs' bottom edge so the swap and search buttons line up with them.
  barRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  airport: { flex: 1.4, minWidth: 0 },
  date: { flex: 1, minWidth: 0 },
  ticketClass: { flex: 1, minWidth: 0 },
  swapRow: { alignItems: 'flex-end', marginVertical: -space.sm },
  swap: {
    width: SWAP,
    height: SWAP,
    borderRadius: SWAP / 2,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  swapHovered: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  focused: { outlineColor: colors.primary, outlineStyle: 'solid', outlineWidth: 2, outlineOffset: 2 },
});
