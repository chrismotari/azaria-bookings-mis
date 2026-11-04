import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { Airline } from '../api/types';
import { colors, font, radius, weight } from '../theme';

/** First letters of the first two words, or the first two letters of a one-word name. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '').slice(0, 2);
  return letters.toUpperCase();
}

/**
 * The airline's logo, or its initials when it has none (or the image fails to load). Both share one frame,
 * so a list mixing logos and initials looks even.
 */
export function AirlineBadge({ airline, size = 40 }: { airline: Airline; size?: number }) {
  const [failed, setFailed] = useState(false);
  const frame = [styles.frame, { width: size, height: size }];
  if (airline.logo_url && !failed) {
    return (
      <View style={[frame, styles.logoFrame]} aria-hidden>
        <Image
          source={{ uri: airline.logo_url }}
          style={styles.logo}
          resizeMode="contain"
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      </View>
    );
  }
  return (
    <View style={[frame, styles.initialsFrame]} aria-hidden>
      <Text style={[styles.initials, size < 36 && styles.initialsSmall]}>{initials(airline.name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: radius.md,
    // Keeps the frame visible on a selected (tinted) card.
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoFrame: { backgroundColor: colors.surface, padding: 3 },
  logo: { width: '100%', height: '100%' },
  initialsFrame: { backgroundColor: colors.primaryTint },
  initials: { fontSize: font.small, fontWeight: weight.heavy, color: colors.primary },
  initialsSmall: { fontSize: font.caption },
});
