import { StyleSheet, Text, View } from 'react-native';

import { colors, font, weight } from '../theme';

/** First letters of the first two words, or the first two letters of a one-word name. */
function initials(airline: string): string {
  const words = airline.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '').slice(0, 2);
  return letters.toUpperCase();
}

/** The airline's initials in a tinted circle (no logos). */
export function AirlineBadge({ airline }: { airline: string }) {
  return (
    <View style={styles.badge} aria-hidden>
      <Text style={styles.text}>{initials(airline)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontSize: font.small, fontWeight: weight.heavy, color: colors.primary },
});
