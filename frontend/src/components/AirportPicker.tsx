import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { api } from '../api/client';
import { Airport } from '../api/types';
import { colors, font, weight } from '../theme';
import { useDebounced } from '../utils/useDebounced';
import { Field, inputStyle } from './Field';
import { Flag } from './Flag';
import { PressState } from './pressState';

function airportLabel(airport: Airport): string {
  return `${airport.code} · ${airport.city}, ${airport.country}`;
}


/** Matches from /airports for what the user has typed (at least two characters). */
function AirportSuggestions({ text, onSelect }: { text: string; onSelect: (airport: Airport) => void }) {
  const search = useDebounced(text.trim(), 250);
  const results = useQuery({
    queryKey: ['airports', search],
    queryFn: async () => (await api.get<Airport[]>('/airports', { params: { search } })).data,
    enabled: search.length >= 2,
    staleTime: 5 * 60 * 1000,
  });

  if (search.length < 2) {
    return null;
  }
  return (
    <View style={styles.results}>
      {results.isPending ? <ActivityIndicator color={colors.primary} style={styles.message} /> : null}
      {results.isError ? <Text style={styles.message}>Could not search airports.</Text> : null}
      {results.data?.length === 0 ? <Text style={styles.message}>No airports found.</Text> : null}
      {results.data?.map((airport) => (
        <Pressable
          key={airport.id}
          accessibilityRole="button"
          onPress={() => onSelect(airport)}
          style={({ pressed, hovered }: PressState) => [styles.option, (pressed || hovered) && styles.pressed]}
        >
          <View style={styles.flagSlot}>
            <Flag code={airport.country_code} />
          </View>
          <Text style={styles.code}>{airport.code}</Text>
          <Text style={styles.optionText} numberOfLines={1}>
            {airport.name} — {airport.city}, {airport.country}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

type PickerProps = {
  label: string;
  value: Airport | null;
  onChange: (airport: Airport | null) => void;
  error?: string;
};

/** Autocomplete over /airports; the value must be a chosen airport. */
export function AirportPicker({ label, value, onChange, error }: PickerProps) {
  const [text, setText] = useState('');

  if (value) {
    return (
      <Field label={label} error={error}>
        <View style={[inputStyle, styles.selected]}>
          <View style={styles.selectedLabel}>
            <Flag code={value.country_code} />
            <Text style={styles.selectedText} numberOfLines={1}>
              {airportLabel(value)}
            </Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => onChange(null)}>
            <Text style={styles.change}>Change</Text>
          </Pressable>
        </View>
      </Field>
    );
  }

  return (
    <Field label={label} error={error}>
      <TextInput
        style={inputStyle}
        value={text}
        onChangeText={setText}
        placeholder="City, airport or code"
        accessibilityLabel={label}
        placeholderTextColor={colors.placeholder}
        autoCorrect={false}
      />
      <AirportSuggestions
        text={text}
        onSelect={(airport) => {
          setText('');
          onChange(airport);
        }}
      />
    </Field>
  );
}

/** Free text, or an airport chosen from the suggestions. */
export type AirportQuery = { text: string; airport: Airport | null };

type SearchFieldProps = {
  label: string;
  value: AirportQuery;
  onChange: (value: AirportQuery) => void;
  onSubmitEditing?: () => void;
};

/** A search box that suggests airports but also accepts any city, country or code as typed. */
export function AirportSearchField({ label, value, onChange, onSubmitEditing }: SearchFieldProps) {
  const [focused, setFocused] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(blurTimer.current ?? undefined), []);

  return (
    <Field label={label}>
      <TextInput
        style={inputStyle}
        value={value.airport ? airportLabel(value.airport) : value.text}
        onChangeText={(text) => onChange({ text, airport: null })}
        onFocus={() => {
          clearTimeout(blurTimer.current ?? undefined);
          setFocused(true);
        }}
        // Delayed so that pressing a suggestion registers before the list closes.
        onBlur={() => {
          blurTimer.current = setTimeout(() => setFocused(false), 200);
        }}
        onSubmitEditing={onSubmitEditing}
        placeholder="City, country or code"
        accessibilityLabel={label}
        placeholderTextColor={colors.placeholder}
        autoCorrect={false}
        selectTextOnFocus={value.airport !== null}
      />
      {focused && !value.airport ? (
        <AirportSuggestions
          text={value.text}
          onSelect={(airport) => {
            setFocused(false);
            onChange({ text: airport.code, airport });
          }}
        />
      ) : null}
    </Field>
  );
}

const styles = StyleSheet.create({
  selected: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  selectedText: { flexShrink: 1, color: colors.text, fontSize: font.body },
  change: { color: colors.primary, fontWeight: weight.semibold },
  results: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: colors.surface,
    maxHeight: 260,
    overflow: 'scroll',
  },
  option: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10 },
  // Keeps codes aligned whether or not an airport has a flag.
  flagSlot: { width: 16 },
  selectedLabel: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  pressed: { backgroundColor: colors.background },
  code: { fontWeight: weight.bold, color: colors.text, width: 40 },
  optionText: { flexShrink: 1, color: colors.text },
  message: { padding: 10, color: colors.muted },
});
