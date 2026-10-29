import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { api } from '../api/client';
import { Airport } from '../api/types';
import { colors } from '../theme';
import { Field, inputStyle } from './Field';

type Props = {
  label: string;
  value: Airport | null;
  onChange: (airport: Airport | null) => void;
  error?: string;
};

export function airportLabel(airport: Airport): string {
  return `${airport.code} · ${airport.city}, ${airport.country}`;
}

function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Autocomplete over /airports; the value is the chosen airport. */
export function AirportPicker({ label, value, onChange, error }: Props) {
  const [text, setText] = useState('');
  const search = useDebounced(text.trim(), 250);
  const results = useQuery({
    queryKey: ['airports', search],
    queryFn: async () => (await api.get<Airport[]>('/airports', { params: { search } })).data,
    enabled: !value && search.length >= 2,
    staleTime: 5 * 60 * 1000,
  });

  if (value) {
    return (
      <Field label={label} error={error}>
        <View style={[inputStyle, styles.selected]}>
          <Text style={styles.selectedText} numberOfLines={1}>
            {airportLabel(value)}
          </Text>
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
        placeholderTextColor="#98a2ad"
        autoCorrect={false}
      />
      {search.length >= 2 ? (
        <View style={styles.results}>
          {results.isPending ? <ActivityIndicator color={colors.primary} style={styles.message} /> : null}
          {results.isError ? <Text style={styles.message}>Could not search airports.</Text> : null}
          {results.data?.length === 0 ? <Text style={styles.message}>No airports found.</Text> : null}
          {results.data?.map((airport) => (
            <Pressable
              key={airport.id}
              accessibilityRole="button"
              onPress={() => {
                setText('');
                onChange(airport);
              }}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            >
              <Text style={styles.code}>{airport.code}</Text>
              <Text style={styles.optionText} numberOfLines={1}>
                {airport.name} — {airport.city}, {airport.country}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Field>
  );
}

const styles = StyleSheet.create({
  selected: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  selectedText: { flexShrink: 1, color: colors.text, fontSize: 15 },
  change: { color: colors.primary, fontWeight: '600' },
  results: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: colors.surface,
    maxHeight: 260,
    overflow: 'scroll',
  },
  option: { flexDirection: 'row', gap: 8, paddingVertical: 8, paddingHorizontal: 10 },
  pressed: { backgroundColor: colors.background },
  code: { fontWeight: '700', color: colors.text, width: 40 },
  optionText: { flexShrink: 1, color: colors.text },
  message: { padding: 10, color: colors.muted },
});
