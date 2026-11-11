import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { api } from '../api/client';
import { Airline } from '../api/types';
import { colors, font, space, weight } from '../theme';
import { useDebounced } from '../utils/useDebounced';
import { AirlineBadge } from './AirlineBadge';
import { Field, inputStyle } from './Field';
import { PressState } from './pressState';

type Props = {
  label: string;
  value: Airline | null;
  onChange: (airline: Airline | null) => void;
  error?: string;
  /** Read by screen readers instead of the label, e.g. to tell repeated fields apart. */
  accessibilityLabel?: string;
};

/** Search of the shared airline list (admin only); the value must be a chosen airline. */
export function AirlinePicker({ label, value, onChange, error, accessibilityLabel = label }: Props) {
  const [text, setText] = useState('');

  if (value) {
    return (
      <Field label={label} error={error}>
        <View style={[inputStyle, styles.selected]}>
          <AirlineBadge airline={value} size={28} />
          <Text style={styles.selectedText} numberOfLines={1}>
            {value.name} · {value.iata_code}
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
        placeholder="Airline name or code"
        accessibilityLabel={accessibilityLabel}
        placeholderTextColor={colors.placeholder}
        autoCorrect={false}
      />
      <AirlineSuggestions
        text={text}
        onSelect={(airline) => {
          setText('');
          onChange(airline);
        }}
      />
    </Field>
  );
}

function AirlineSuggestions({ text, onSelect }: { text: string; onSelect: (airline: Airline) => void }) {
  const search = useDebounced(text.trim(), 250);
  const results = useQuery({
    queryKey: ['admin', 'airlines', search],
    queryFn: async () => (await api.get<Airline[]>('/airlines', { params: { search } })).data,
    enabled: search.length >= 2,
    staleTime: 5 * 60 * 1000,
  });

  if (search.length < 2) {
    return null;
  }
  return (
    <View style={styles.results}>
      {results.isPending ? <ActivityIndicator color={colors.primary} style={styles.message} /> : null}
      {results.isError ? <Text style={styles.message}>Could not search airlines.</Text> : null}
      {results.data?.length === 0 ? <Text style={styles.message}>No active airlines found.</Text> : null}
      {results.data?.map((airline) => (
        <Pressable
          key={airline.id}
          accessibilityRole="button"
          accessibilityLabel={`${airline.name}, ${airline.iata_code}`}
          onPress={() => onSelect(airline)}
          style={({ pressed, hovered }: PressState) => [styles.option, (pressed || hovered) && styles.pressed]}
        >
          <AirlineBadge airline={airline} size={28} />
          <Text style={styles.code}>{airline.iata_code}</Text>
          <Text style={styles.optionText} numberOfLines={1}>
            {airline.name}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  selected: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 4 },
  selectedText: { flex: 1, color: colors.text, fontSize: font.body },
  change: { color: colors.primary, fontWeight: weight.semibold },
  results: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: colors.surface,
    maxHeight: 260,
    overflow: 'scroll',
  },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6, paddingHorizontal: 10 },
  pressed: { backgroundColor: colors.background },
  code: { fontWeight: weight.bold, color: colors.text, width: 28 },
  optionText: { flexShrink: 1, color: colors.text },
  message: { padding: 10, color: colors.muted },
});
