import { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { useAgencyName } from '../../agency/agency';
import { useModules } from '../../agency/modules';
import { Module } from '../../api/types';
import { GetAppFooter } from '../../agency/GetAppFooter';
import { Card } from '../../components/Card';
import { Icon, IconName } from '../../components/Icon';
import { Screen } from '../../components/Screen';
import { IS_PLATFORM } from '../../config';
import { colors, createStyles, font, radius, space, useIsWide, weight } from '../../theme';

const OFFERS: Record<Module, string> = { flights: 'flight deals', tours: 'tours', hotels: 'hotel stays' };

const BENEFITS: Record<Module, { icon: IconName; text: string }[]> = {
  flights: [
    { icon: 'airplane-outline', text: 'Hand-picked flight deals' },
    { icon: 'chatbubbles-outline', text: 'Ask us for options when nothing fits' },
    { icon: 'ticket-outline', text: 'Boarding passes in the app and your inbox' },
  ],
  tours: [
    { icon: 'map-outline', text: 'Book your places on a tour instantly' },
    { icon: 'people-outline', text: 'Options for couples, families and groups' },
    { icon: 'mail-outline', text: 'Tour updates in your inbox' },
  ],
  hotels: [
    { icon: 'bed-outline', text: 'Hotels, lodges and camps we work with' },
    { icon: 'calendar-outline', text: 'Prices for your dates and party' },
    { icon: 'document-text-outline', text: 'Vouchers in the app and your inbox' },
  ],
};

/** "Flight deals, tours and hotel stays from our travel agents, booked in a few steps." for the modules on. */
function tagline(modules: Module[]): string {
  const offers = modules.map((module) => OFFERS[module]);
  const list = offers.length > 1 ? `${offers.slice(0, -1).join(', ')} and ${offers[offers.length - 1]}` : offers[0];
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} from our travel agents, booked in a few steps.`;
}

/** Three ticks, taken in turn from each module on. */
function benefits(modules: Module[]) {
  return [0, 1, 2].flatMap((index) => modules.map((module) => BENEFITS[module][index])).slice(0, 3);
}

/** Wide: brand panel beside the form. Narrow: the form card alone. */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const isWide = useIsWide();
  const agencyName = useAgencyName();
  const modules = useModules();
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
          <Text style={styles.brand}>{IS_PLATFORM ? 'Dira Manifest' : agencyName}</Text>
          <Text style={styles.tagline}>{tagline(modules)}</Text>
          <View style={styles.benefits}>
            {benefits(modules).map((benefit) => (
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

const styles = createStyles(() => ({
  split: { flexDirection: 'row', gap: space.xl, marginTop: space.xl, alignItems: 'stretch' },
  panel: {
    flex: 1,
    backgroundColor: colors.bar,
    borderWidth: 1,
    borderColor: colors.barEdge,
    borderRadius: radius.lg,
    padding: space.xxl,
    gap: space.lg,
    justifyContent: 'center',
  },
  brand: { fontSize: font.display, fontWeight: weight.heavy, color: colors.barText },
  tagline: { fontSize: font.heading, color: colors.barText, opacity: 0.9 },
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
  benefitText: { flexShrink: 1, fontSize: font.body, color: colors.barText },
  formColumn: { flex: 1, justifyContent: 'center' },
  title: { fontSize: font.title, fontWeight: weight.heavy, color: colors.text },
}));
