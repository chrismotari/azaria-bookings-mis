import { Pressable, View } from 'react-native';

import { TICKET_CLASSES, TicketClass } from '../../api/types';
import { AirportSearchField } from '../../components/AirportPicker';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { FieldGrid } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { OfferFilterErrors, OfferFilterValues, TRIP_TYPE_OPTIONS } from '../../components/OfferFilterFields';
import { PressState } from '../../components/pressState';
import { SegmentedControl } from '../../components/SegmentedControl';
import { SelectField } from '../../components/SelectField';
import { colors, createStyles, space } from '../../theme';
import { HeadingCard, SearchPanel } from './HeadingCard';

const CLASS_OPTIONS: { value: '' | TicketClass; label: string }[] = [{ value: '', label: 'Any' }, ...TICKET_CLASSES];

type Props = {
  value: OfferFilterValues;
  onChange: (value: OfferFilterValues) => void;
  errors: OfferFilterErrors;
  onSearch: () => void;
  /** Stacks the fields for a narrow column. */
  compact: boolean;
};

/** Flights' heading card: the headline and the search panel (trip type, route, dates, class). */
export function ExploreSearchBar({ value, onChange, errors, onSearch, compact }: Props) {
  const set = <K extends keyof OfferFilterValues>(key: K, fieldValue: OfferFilterValues[K]) =>
    onChange({ ...value, [key]: fieldValue });
  const swap = () => onChange({ ...value, origin: value.destination, destination: value.origin });

  const from = (
    <AirportSearchField
      label="From"
      value={value.origin}
      onChange={(q) => set('origin', q)}
      onSubmitEditing={onSearch}
    />
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
    <DateField
      label="Departing from"
      value={value.date_from}
      onChange={(d) => set('date_from', d)}
      error={errors.date_from}
    />
  );
  const dateTo = (
    <DateField
      label="Departing until"
      value={value.date_to}
      onChange={(d) => set('date_to', d)}
      error={errors.date_to}
    />
  );
  const ticketClass = (
    <SelectField
      label="Class"
      options={CLASS_OPTIONS}
      value={value.ticket_class}
      onChange={(c) => set('ticket_class', c)}
    />
  );
  const search = <Button title="Search" variant="accent" icon="search" onPress={onSearch} />;
  const tripType = (
    <View style={compact ? undefined : styles.tripType}>
      <SegmentedControl
        label="Trip type"
        options={TRIP_TYPE_OPTIONS}
        value={value.trip_type}
        onChange={(t) => set('trip_type', t)}
      />
    </View>
  );
  const returning = value.trip_type === 'return';
  const returnFrom = (
    <DateField
      label="Returning from"
      value={value.return_from}
      onChange={(d) => set('return_from', d)}
      error={errors.return_from}
    />
  );
  const returnTo = (
    <DateField
      label="Returning until"
      value={value.return_to}
      onChange={(d) => set('return_to', d)}
      error={errors.return_to}
    />
  );

  return (
    <HeadingCard title="Find your next flight deal" compact={compact}>
      <SearchPanel>
        {compact ? (
          <>
            {tripType}
            {from}
            <View style={styles.swapRow}>
              <SwapButton onPress={swap} vertical />
            </View>
            {to}
            <FieldGrid>
              {dateFrom}
              {dateTo}
            </FieldGrid>
            {returning ? (
              <FieldGrid>
                {returnFrom}
                {returnTo}
              </FieldGrid>
            ) : null}
            {ticketClass}
            {search}
          </>
        ) : (
          <>
            <View style={styles.barRow}>
              {tripType}
              <View style={styles.airport}>{from}</View>
              <SwapButton onPress={swap} />
              <View style={styles.airport}>{to}</View>
            </View>
            <View style={styles.barRow}>
              <View style={styles.date}>{dateFrom}</View>
              <View style={styles.date}>{dateTo}</View>
              {returning ? <View style={styles.date}>{returnFrom}</View> : null}
              {returning ? <View style={styles.date}>{returnTo}</View> : null}
              <View style={styles.ticketClass}>{ticketClass}</View>
              {search}
            </View>
          </>
        )}
      </SearchPanel>
    </HeadingCard>
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

const styles = createStyles(() => ({
  // Aligned on the inputs' bottom edge so the swap and search buttons line up with them.
  barRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  airport: { flex: 1.4, minWidth: 0 },
  date: { flex: 1, minWidth: 0 },
  ticketClass: { flex: 1, minWidth: 0 },
  tripType: { width: 260, marginBottom: 1 },
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
}));
