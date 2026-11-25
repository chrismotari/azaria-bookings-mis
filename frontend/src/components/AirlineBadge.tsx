import { useState } from 'react';
import { Image, Text, View } from 'react-native';

import { Airline } from '../api/types';
import { colors, createStyles, font, radius, weight } from '../theme';

/** Logo, or the IATA code when there is none or it fails to load; both share one frame so mixed lists line up. */
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
    <View style={[frame, styles.codeFrame]} aria-hidden>
      <Text style={[styles.code, size < 36 && styles.codeSmall]}>{airline.iata_code}</Text>
    </View>
  );
}

const styles = createStyles(() => ({
  frame: {
    borderRadius: radius.md,
    // Keeps the frame visible on a selected (tinted) card.
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Square logos fill the frame edge to edge.
  logoFrame: { backgroundColor: colors.surface, borderWidth: 0 },
  logo: { width: '100%', height: '100%' },
  codeFrame: { backgroundColor: colors.primaryTint },
  code: { fontSize: font.small, fontWeight: weight.heavy, color: colors.primary },
  codeSmall: { fontSize: font.caption },
}));
