import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GetAppFooter } from '../../agency/GetAppFooter';
import { Card } from '../../components/Card';
import { Icon, IconName } from '../../components/Icon';
import { Screen } from '../../components/Screen';
import { colors, font, radius, space, useIsWide, weight } from '../../theme';

const BENEFITS: { icon: IconName; text: string }[] = [
  { icon: 'airplane-outline', text: 'Hand-picked flight deals' },
  { icon: 'chatbubbles-outline', text: 'Ask us for options when nothing fits' },
  { icon: 'ticket-outline', text: 'Boarding passes in the app and your inbox' },
];

/** Wide: brand panel beside the form. Narrow: the form card alone. */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const isWide = useIsWide();
  const form = (
    <Card>
      <Text style={styles.title}>{title}</Text>
      {children}
    </Card>
  );
  if (!isWide) {
    return (
      <Screen maxWidth={440}>
        {form}
        <GetAppFooter />
      </Screen>
    );
  }
  return (
    <Screen maxWidth={960}>
      <View style={styles.split}>
        <View style={styles.panel}>
          <Text style={styles.brand}>Azaria Bookings</Text>
          <Text style={styles.tagline}>Flight deals from our travel agents, booked in a few steps.</Text>
          <View style={styles.benefits}>
            {BENEFITS.map((benefit) => (
              <View key={benefit.text} style={styles.benefit}>
                <View style={styles.benefitIcon}>
                  <Icon name={benefit.icon} size={18} color={colors.accentText} />
                </View>
                <Text style={styles.benefitText}>{benefit.text}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.formColumn}>{form}</View>
      </View>
      <GetAppFooter />
    </Screen>
  );
}

const styles = StyleSheet.create({
  split: { flexDirection: 'row', gap: space.xl, marginTop: space.xl, alignItems: 'stretch' },
  panel: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: space.xxl,
    gap: space.lg,
    justifyContent: 'center',
  },
  brand: { fontSize: font.display, fontWeight: weight.heavy, color: colors.primaryText },
  tagline: { fontSize: font.heading, color: colors.primaryText, opacity: 0.9 },
  benefits: { gap: space.md, marginTop: space.sm },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  benefitIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitText: { flexShrink: 1, fontSize: font.body, color: colors.primaryText },
  formColumn: { flex: 1, justifyContent: 'center' },
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
});
