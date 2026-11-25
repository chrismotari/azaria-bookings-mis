import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextStyle, useWindowDimensions, View } from 'react-native';

import { api } from '../../api/client';
import { PublicPlans } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { Icon, IconName } from '../../components/Icon';
import { billed, enquirySubject, PlanShowcase } from '../../components/PlanShowcase';
import { PressState } from '../../components/pressState';
import { ErrorState, LoadingState } from '../../components/StatusViews';
import { Brand } from '../../navigation/PlatformPublicBar';
import { openChat } from '../../support/launcher';
import { colors, createStyles, font, radius, shadow, shadowRaised, siteFont, space, weight } from '../../theme';
import { DashboardMock, ExploreMock, FlightMock, HotelMock, TourMock } from './SiteMocks';
import { getStarted, scrollToSection, SectionId, SITE_DESCRIPTION, takePendingSection } from './site';

const WIDE = 900;

type Product = {
  id: Exclude<SectionId, 'products'>;
  name: string;
  icon: IconName;
  line: string;
  ticks: string[];
  title: string;
  points: { title: string; text: string }[];
};

const PRODUCTS: Product[] = [
  {
    id: 'flights',
    name: 'Flights',
    icon: 'airplane',
    line: 'Publish fares and take booking requests',
    ticks: ['One-way and return offers', 'Requests for options', 'Boarding passes by email and in the app'],
    title: 'Flights: fares your customers can book',
    points: [
      {
        title: 'Offers with every detail',
        text: 'Publish one-way and return offers with full itineraries, baggage and fare conditions.',
      },
      {
        title: 'Fare search',
        text: 'Search fares across Travelport, Sabre and Amadeus by route and date, review them and publish with your markup. Saved routes refresh on a schedule.',
      },
      { title: 'Requests for options', text: 'Customers ask for options and you answer with offers.' },
      {
        title: 'Bookings',
        text: 'Passenger details on every booking: you confirm availability, and the customer pays before a deadline with automatic reminders.',
      },
      { title: 'Boarding passes', text: 'Delivered by email and in the app.' },
    ],
  },
  {
    id: 'tours',
    name: 'Tours',
    icon: 'location',
    line: 'Sell scheduled tours with instant booking',
    ticks: ['Dates, slots and price options', 'Confirmed instantly', 'Change and cancellation notices'],
    title: 'Tours: fill every seat',
    points: [
      {
        title: 'Dates, slots and price options',
        text: 'Fixed dates and slots, with price options such as Regular, VIP, Couple and Group of 6.',
      },
      {
        title: 'Instant booking',
        text: 'Customers book and get confirmed instantly, with travellers added now or later.',
      },
      { title: 'Your own policy', text: 'Booking and cancellation deadlines, with your own cancellation policy.' },
      {
        title: 'Changes, in your words',
        text: 'Tell every booked customer about a change or cancellation in your own words.',
      },
      { title: 'Always on show', text: 'Fully booked tours stay on show, so customers see what you run.' },
    ],
  },
  {
    id: 'hotels',
    name: 'Hotels',
    icon: 'bed',
    line: 'Sell stays with seasonal room rates',
    ticks: [
      'Room types and seasonal rates',
      'Requests you confirm with the hotel',
      'Vouchers with confirmation numbers',
    ],
    title: 'Hotels: your partner stays, priced by season',
    points: [
      {
        title: 'Rooms and rates',
        text: 'Room types with seasonal rates, an optional charge per adult, and occupancy rules.',
      },
      {
        title: 'Requests you confirm',
        text: 'Customers choose dates and rooms and send a request. You confirm with the hotel, possibly at a new price, which they accept.',
      },
      { title: 'Vouchers', text: "Mark paid, then send the hotel's voucher with its confirmation number." },
    ],
  },
];

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'globe-outline', title: 'Your own site', text: 'Your own address, extra domains and your colours.' },
  { icon: 'phone-portrait-outline', title: 'Mobile app', text: 'Customers find your agency by link or code.' },
  {
    icon: 'star-outline',
    title: 'Featured on Explore',
    text: 'Put your best flights, tours and stays first on your home page.',
  },
  {
    icon: 'chatbox-ellipses-outline',
    title: 'Reviews and ratings',
    text: 'Customers rate finished trips, and you reply or hide a review.',
  },
  {
    icon: 'chatbubbles-outline',
    title: 'Live support chat',
    text: 'Customers and visitors write to you from any page.',
  },
  {
    icon: 'people-outline',
    title: 'Customer accounts',
    text: 'Customers keep their bookings in one place, and your admins can book for them.',
  },
  {
    icon: 'mail-outline',
    title: 'Emails at every step',
    text: 'Confirmations, reminders and updates go out by themselves.',
  },
  {
    icon: 'stats-chart-outline',
    title: 'A dashboard across your products',
    text: "What needs action, sales by month and what's coming up.",
  },
  {
    icon: 'shield-checkmark-outline',
    title: 'Your data kept apart',
    text: "Your customers and bookings are kept apart from every other agency's.",
  },
];

const STEPS: { title: string; text: string }[] = [
  {
    title: 'Choose a plan and your products',
    text: 'Flights, tours, hotels, or all three, billed monthly or yearly.',
  },
  {
    title: 'Add your colours, offers, tours and hotels',
    text: 'Set up your site from your own admin, at your own pace.',
  },
  {
    title: 'Share your link and start taking bookings',
    text: 'Customers book on the web or in the app.',
  },
];

const QUESTIONS: { question: string; answer: string }[] = [
  {
    question: 'Do I need a GDS contract?',
    answer: 'No. Fare search is optional: you can publish every fare by hand, with its full itinerary.',
  },
  {
    question: 'Can I sell only tours or only hotels?',
    answer: 'Yes. Flights, tours and hotels are separate products: take any one of the three, two, or all of them.',
  },
  {
    question: 'How do customers pay?',
    answer: 'As your agency instructs them, outside the system. You mark each booking paid when the money arrives.',
  },
  {
    question: 'Can I use my own domain?',
    answer: 'Yes. Your site comes with its own address, and extra domains can be added to it.',
  },
  {
    question: 'Is there a mobile app?',
    answer: 'Yes, one shared app for every agency. Your customers reach your agency through your link or your code.',
  },
  {
    question: 'How do I get help?',
    answer: 'Through the support chat: write to us from your admin, or from the message button on this page.',
  },
];

/** The website's width class: wide shows columns side by side, and the feature grid's column count. */
function useLayout() {
  const { width } = useWindowDimensions();
  return { wide: width >= WIDE, roomy: width >= 1100, columns: width >= 1024 ? 3 : width >= 640 ? 2 : 1 };
}

/** The root host's public home page: Azaria's sales website. */
export function PlatformHomeScreen() {
  const navigation = useNavigation();
  const { wide, roomy } = useLayout();
  const target = useRef<SectionId | null>(null);
  const until = useRef(0);

  const jump = useCallback(() => {
    if (target.current && Date.now() < until.current) {
      scrollToSection(target.current, false);
    }
  }, []);
  // A section from the address (/#hotels) or a bar link on /pricing: scrolled to while the page settles.
  useFocusEffect(
    useCallback(() => {
      const id = takePendingSection();
      if (!id) {
        return;
      }
      target.current = id;
      until.current = Date.now() + 1500;
      const timers = [50, 400, 1000].map((delay) => setTimeout(jump, delay));
      return () => timers.forEach(clearTimeout);
    }, [jump]),
  );

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    let meta = document.querySelector('meta[name="description"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    const before = meta.getAttribute('content') ?? '';
    meta.setAttribute('content', SITE_DESCRIPTION);
    return () => {
      if (created) {
        meta.remove();
      } else {
        meta.setAttribute('content', before);
      }
    };
  }, []);

  const toPricing = () => navigation.navigate('PlatformPricing');

  return (
    <ScrollView style={styles.scroll} onContentSizeChange={jump}>
      <Band id="top" tone="primary">
        <View style={[styles.split, wide && styles.splitWide]}>
          <View style={[styles.heroText, wide && styles.heroTextWide]}>
            <View style={styles.badge}>
              <Icon name="sparkles" size={14} color={colors.accent} />
              <Text style={styles.badgeText}>Booking platform for travel agencies</Text>
            </View>
            <Heading level={1} style={[styles.h1, !wide && styles.h1Narrow]}>
              Your travel agency, online
            </Heading>
            <Text style={[styles.heroLead, !wide && styles.leadNarrow]}>
              Sell flights, tours and hotel stays from your own booking site and app. Take one product, two, or all
              three.
            </Text>
            <View style={styles.actions}>
              <MainAction />
              <Button title="See pricing" variant="secondary" onPress={toPricing} />
            </View>
            <View style={styles.heroTicks}>
              {['Your own address and colours', 'Web and mobile app', 'Nothing to install'].map((text) => (
                <View key={text} style={styles.tick}>
                  <Icon name="checkmark-circle" size={18} color={colors.accent} />
                  <Text style={styles.heroTick}>{text}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={[styles.visual, wide && styles.heroVisualWide]}>
            <ExploreMock />
          </View>
        </View>
      </Band>

      <Band id="products" tone="background">
        <SectionHeader
          eyebrow="Products"
          title="One platform, three products"
          lead="Each is a module: switch on what you sell, add the rest when you're ready."
        />
        <View style={[styles.cards, wide && styles.cardsWide]}>
          {PRODUCTS.map((product) => (
            <ProductCard key={product.id} product={product} wide={wide} />
          ))}
        </View>
      </Band>

      {PRODUCTS.map((product, index) => (
        <Band key={product.id} id={product.id} tone={index % 2 ? 'background' : 'surface'}>
          <View style={[styles.split, wide && (index % 2 ? styles.splitWideReverse : styles.splitWide)]}>
            <View style={[styles.productText, wide && styles.productTextWide]}>
              <View style={styles.pill}>
                <Icon name={product.icon} size={16} color={colors.primary} />
                <Text style={styles.pillText}>{product.name}</Text>
              </View>
              <Heading level={2} style={[styles.h2, !roomy && styles.h2Mid, !wide && styles.h2Narrow]}>
                {product.title}
              </Heading>
              <View style={styles.points}>
                {product.points.map((point) => (
                  <View key={point.title} style={styles.point}>
                    <View style={styles.pointIcon}>
                      <Icon name="checkmark" size={16} color={colors.primary} />
                    </View>
                    <View style={styles.pointText}>
                      <Text style={styles.pointTitle}>{point.title}</Text>
                      <Text style={styles.body}>{point.text}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
            <View style={[styles.visual, wide && styles.productVisualWide]}>
              {product.id === 'flights' ? <FlightMock /> : product.id === 'tours' ? <TourMock /> : <HotelMock />}
            </View>
          </View>
        </Band>
      ))}

      <Band tone="background">
        <SectionHeader
          eyebrow="Features"
          title="Everything you need to run the agency"
          lead="Around every booking, the tools that keep customers coming back."
        />
        <FeatureGrid />
      </Band>

      <Band tone="surface">
        <SectionHeader
          eyebrow="Dashboard"
          title="See the whole business at a glance"
          lead="What needs action, sales across your products and what's coming up."
        />
        <View style={styles.dashboard}>
          <DashboardMock />
        </View>
      </Band>

      <Band tone="background">
        <SectionHeader eyebrow="How it works" title="Up and running in three steps" />
        <View style={[styles.steps, wide && styles.stepsWide]}>
          {STEPS.map((step, index) => (
            <View key={step.title} style={[styles.step, wide && styles.stepWide]}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>{index + 1}</Text>
              </View>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Text style={[styles.body, styles.center]}>{step.text}</Text>
            </View>
          ))}
        </View>
      </Band>

      <Band tone="surface">
        <SectionHeader
          eyebrow="Pricing"
          title="Simple plans, billed monthly or yearly"
          lead="Every plan gives you your own booking site. Pay monthly, or yearly and save."
        />
        <PricingPreview />
        <View style={styles.centerRow}>
          <Button title="See all plans" variant="secondary" icon="arrow-forward" onPress={toPricing} />
        </View>
      </Band>

      <Band tone="background">
        <View style={[styles.split, wide && styles.splitWide]}>
          <View style={[styles.faqIntro, wide && styles.faqIntroWide]}>
            <Text style={styles.eyebrow}>Questions</Text>
            <Heading level={2} style={[styles.h2, !roomy && styles.h2Mid, !wide && styles.h2Narrow]}>
              Questions agencies ask
            </Heading>
            <Text style={[styles.lead, !wide && styles.leadNarrow]}>
              Anything else? Write to us in the support chat.
            </Text>
          </View>
          <View style={[styles.visual, wide && styles.faqWide]}>
            <Questions />
          </View>
        </View>
      </Band>

      <Band tone="primary">
        <View style={styles.closing}>
          <Heading level={2} style={[styles.h2, styles.onPrimary, styles.center, !wide && styles.h2Narrow]}>
            Ready to take bookings online?
          </Heading>
          <Text style={[styles.heroLead, styles.center, !wide && styles.leadNarrow]}>
            Start with one product and add the rest when you're ready.
          </Text>
          <View style={[styles.actions, styles.centerRow]}>
            <MainAction />
            <Button title="See pricing" variant="secondary" onPress={toPricing} />
          </View>
        </View>
      </Band>

      <Footer />
    </ScrollView>
  );
}

/** A real heading on the web (h1, h2, ...), for screen readers and search. */
function Heading({
  level,
  style,
  children,
}: {
  level: number;
  style: TextStyle | (TextStyle | false)[];
  children: string;
}) {
  return (
    <Text role="heading" aria-level={level} style={style}>
      {children}
    </Text>
  );
}

/** A full-width band; its content is centred at the website's width. */
function Band({
  id,
  tone,
  children,
}: {
  id?: string;
  tone: 'primary' | 'surface' | 'background';
  children: ReactNode;
}) {
  const { wide } = useLayout();
  return (
    <View id={id} style={styles[tone]}>
      <View style={[styles.band, !wide && styles.bandNarrow]}>{children}</View>
    </View>
  );
}

function SectionHeader({ eyebrow, title, lead }: { eyebrow: string; title: string; lead?: string }) {
  const { wide } = useLayout();
  return (
    <View style={styles.header}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Heading level={2} style={[styles.h2, styles.center, !wide && styles.h2Narrow]}>
        {title}
      </Heading>
      {lead ? <Text style={[styles.lead, styles.center, !wide && styles.leadNarrow]}>{lead}</Text> : null}
    </View>
  );
}

/** "Get started" (the getting-started chat), or "Open admin" for the signed-in owner. */
function MainAction() {
  const navigation = useNavigation();
  const { user } = useAuth();
  return user ? (
    <Button
      title="Open admin"
      variant="accent"
      icon="grid-outline"
      onPress={() => navigation.navigate('PlatformTabs', { screen: 'PlatformDashboard' })}
    />
  ) : (
    <Button title="Get started" variant="accent" icon="arrow-forward" onPress={getStarted} />
  );
}

function ProductCard({ product, wide }: { product: Product; wide: boolean }) {
  return (
    <View style={[styles.productCard, wide ? styles.productCardWide : styles.productCardNarrow]}>
      <View style={styles.productIcon}>
        <Icon name={product.icon} size={28} color={colors.primary} />
      </View>
      <Heading level={3} style={styles.cardTitle}>
        {product.name}
      </Heading>
      <Text style={styles.cardLine}>{product.line}</Text>
      <View style={styles.cardTicks}>
        {product.ticks.map((text) => (
          <View key={text} style={styles.tick}>
            <Icon name="checkmark-circle" size={18} color={colors.success} />
            <Text style={styles.body}>{text}</Text>
          </View>
        ))}
      </View>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Learn more about ${product.name}`}
        onPress={() => scrollToSection(product.id)}
        style={({ hovered }: PressState) => [styles.learnMore, hovered && styles.learnMoreHovered]}
      >
        <Text style={styles.learnMoreText}>Learn more</Text>
        <Icon name="arrow-forward" size={16} color={colors.primary} />
      </Pressable>
    </View>
  );
}

function FeatureGrid() {
  const { columns } = useLayout();
  return (
    <View style={styles.grid}>
      {FEATURES.map((feature) => (
        <View key={feature.title} style={[styles.gridCell, { width: `${100 / columns}%` }]}>
          <View style={styles.feature}>
            <View style={styles.featureIcon}>
              <Icon name={feature.icon} size={22} color={colors.primary} />
            </View>
            <View style={styles.pointText}>
              <Text style={styles.featureTitle}>{feature.title}</Text>
              <Text style={styles.body}>{feature.text}</Text>
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

function PricingPreview() {
  const plans = useQuery({
    queryKey: ['public', 'plans'],
    queryFn: async () => (await api.get<PublicPlans>('/platform/public-plans')).data,
  });
  if (plans.isPending) {
    return <LoadingState />;
  }
  if (plans.isError) {
    return <ErrorState error={plans.error} onRetry={() => plans.refetch()} />;
  }
  return (
    <PlanShowcase
      plans={plans.data.plans}
      featuredOnly
      actionLabel="Get started"
      onEnquire={(plan, cycle) =>
        openChat({
          subject: enquirySubject(plan, cycle),
          message: `I would like to know more about the ${plan.name} plan, billed ${billed(cycle)}.`,
        })
      }
    />
  );
}

/** An accordion with one answer open at a time. */
function Questions() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <View style={styles.questions}>
      {QUESTIONS.map((item, index) => {
        const expanded = open === index;
        return (
          <View key={item.question} style={[styles.question, expanded && styles.questionOpen]}>
            <Pressable
              accessibilityRole="button"
              aria-expanded={expanded}
              onPress={() => setOpen(expanded ? null : index)}
              style={({ hovered }: PressState) => [styles.questionHead, hovered && styles.questionHovered]}
            >
              <Text style={styles.questionText}>{item.question}</Text>
              <Icon name={expanded ? 'remove' : 'add'} size={22} color={colors.primary} />
            </Pressable>
            {expanded ? <Text style={[styles.body, styles.answer]}>{item.answer}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

function Footer() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { wide } = useLayout();
  const link = (label: string, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="link"
      onPress={onPress}
      style={({ hovered }: PressState) => [styles.footerLink, hovered && styles.footerLinkHovered]}
    >
      <Text style={styles.footerLinkText}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={styles.footer} role="contentinfo">
      <View style={[styles.band, styles.footerBand, !wide && styles.bandNarrow]}>
        <View style={[styles.footerColumns, wide && styles.footerColumnsWide]}>
          <View style={[styles.footerBrand, wide && styles.footerBrandWide]}>
            <Brand />
            <Text style={styles.body}>Booking sites and apps for travel agencies: flights, tours and hotels.</Text>
          </View>
          <View style={styles.footerColumn}>
            <Text style={styles.footerHeading}>Products</Text>
            {PRODUCTS.map((product) => link(product.name, () => scrollToSection(product.id)))}
          </View>
          <View style={styles.footerColumn}>
            <Text style={styles.footerHeading}>Company</Text>
            {link('Pricing', () => navigation.navigate('PlatformPricing'))}
            {user ? null : link('Contact', () => openChat())}
          </View>
        </View>
        <Text style={styles.copyright}>© {new Date().getFullYear()} Azaria Bookings</Text>
      </View>
    </View>
  );
}

const styles = createStyles(() => ({
  scroll: { flex: 1, backgroundColor: colors.background },
  primary: { backgroundColor: colors.primary },
  surface: { backgroundColor: colors.surface },
  background: { backgroundColor: colors.background },
  band: {
    width: '100%',
    maxWidth: 1200 + 2 * space.xl,
    alignSelf: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: 96,
    gap: 56,
  },
  bandNarrow: { paddingHorizontal: space.lg + space.xs, paddingVertical: 64, gap: space.xxl + space.sm },
  split: { gap: space.xxl + space.lg },
  splitWide: { flexDirection: 'row', alignItems: 'center', gap: 64 },
  splitWideReverse: { flexDirection: 'row-reverse', alignItems: 'center', gap: 64 },
  visual: { width: '100%' },
  heroText: { gap: space.xl },
  heroTextWide: { flex: 5, minWidth: 0 },
  heroVisualWide: { flex: 6, minWidth: 0, width: undefined },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryHover,
  },
  badgeText: { fontSize: font.small, fontWeight: weight.semibold, color: colors.primaryText },
  h1: {
    fontSize: siteFont.hero,
    lineHeight: siteFont.hero * 1.08,
    fontWeight: weight.heavy,
    color: colors.primaryText,
    letterSpacing: -1,
  },
  h1Narrow: { fontSize: siteFont.section, lineHeight: siteFont.section * 1.12 },
  heroLead: { fontSize: siteFont.lead, lineHeight: siteFont.lead * 1.5, color: colors.primaryText },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  heroTicks: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.xl, rowGap: space.sm },
  tick: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  heroTick: { fontSize: font.body, fontWeight: weight.semibold, color: colors.primaryText },
  header: { alignItems: 'center', gap: space.md, alignSelf: 'center', maxWidth: 760 },
  eyebrow: {
    fontSize: font.small,
    fontWeight: weight.heavy,
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  h2: {
    fontSize: siteFont.section,
    lineHeight: siteFont.section * 1.15,
    fontWeight: weight.heavy,
    color: colors.text,
    letterSpacing: -0.5,
  },
  h2Mid: { fontSize: font.display + 4, lineHeight: (font.display + 4) * 1.2 },
  h2Narrow: { fontSize: font.display + 2, lineHeight: (font.display + 2) * 1.2 },
  lead: { fontSize: siteFont.lead, lineHeight: siteFont.lead * 1.5, color: colors.muted },
  leadNarrow: { fontSize: font.heading, lineHeight: font.heading * 1.5 },
  center: { textAlign: 'center' },
  centerRow: { justifyContent: 'center', flexDirection: 'row' },
  onPrimary: { color: colors.primaryText },
  body: { fontSize: font.body, lineHeight: 23, color: colors.muted, flexShrink: 1 },
  cards: { gap: space.xl },
  cardsWide: { flexDirection: 'row', alignItems: 'stretch' },
  productCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg + 4,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.xxl,
    gap: space.md,
    ...shadow,
  },
  productCardWide: { flex: 1, minWidth: 0 },
  productCardNarrow: { padding: space.xl },
  productIcon: {
    width: 60,
    height: 60,
    borderRadius: radius.lg + 4,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  cardTitle: { fontSize: font.title + 2, fontWeight: weight.heavy, color: colors.text },
  cardLine: { fontSize: font.heading, lineHeight: 26, color: colors.dark },
  cardTicks: { gap: space.sm, paddingTop: space.sm, paddingBottom: space.md, flexGrow: 1 },
  learnMore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    alignSelf: 'flex-start',
    paddingVertical: space.xs,
    borderBottomWidth: 2,
    borderBottomColor: colors.surface,
  },
  learnMoreHovered: { borderBottomColor: colors.primary },
  learnMoreText: { fontSize: font.body, fontWeight: weight.bold, color: colors.primary },
  productText: { gap: space.xl },
  productTextWide: { flex: 5, minWidth: 0 },
  productVisualWide: { flex: 7, minWidth: 0, width: undefined },
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
  },
  pillText: {
    fontSize: font.small,
    fontWeight: weight.heavy,
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  points: { gap: space.lg + space.xs },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  pointIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointText: { flex: 1, minWidth: 0, gap: 2 },
  pointTitle: { fontSize: font.heading - 1, fontWeight: weight.bold, color: colors.text, lineHeight: 26 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', margin: -space.md },
  gridCell: { padding: space.md },
  feature: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.lg,
    padding: space.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: { fontSize: font.heading - 1, fontWeight: weight.bold, color: colors.text },
  dashboard: { width: '100%', maxWidth: 1080, alignSelf: 'center' },
  steps: { gap: space.xxl },
  stepsWide: { flexDirection: 'row', gap: space.xl },
  step: { gap: space.md, alignItems: 'center' },
  stepWide: { flex: 1 },
  stepNumber: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadowRaised,
  },
  stepNumberText: { fontSize: font.title, fontWeight: weight.heavy, color: colors.primaryText },
  stepTitle: { fontSize: font.heading + 2, fontWeight: weight.bold, color: colors.text, textAlign: 'center' },
  faqIntro: { gap: space.md },
  faqIntroWide: { flex: 4, minWidth: 0, alignSelf: 'flex-start' },
  faqWide: { flex: 7, minWidth: 0, width: undefined },
  questions: { gap: space.md },
  question: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  questionOpen: { borderColor: colors.primary },
  questionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg + space.xs,
  },
  questionHovered: { backgroundColor: colors.primaryTint },
  questionText: { flex: 1, fontSize: font.heading - 1, fontWeight: weight.bold, color: colors.text },
  answer: { paddingHorizontal: space.xl, paddingBottom: space.xl },
  closing: { alignItems: 'center', gap: space.xl, maxWidth: 720, alignSelf: 'center' },
  footer: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  footerBand: { paddingVertical: 56, gap: space.xxl },
  footerColumns: { gap: space.xxl },
  footerColumnsWide: { flexDirection: 'row', gap: 64 },
  footerBrand: { gap: space.md, maxWidth: 360 },
  footerBrandWide: { flex: 1 },
  footerColumn: { gap: space.xs, minWidth: 160 },
  footerHeading: {
    fontSize: font.small,
    fontWeight: weight.heavy,
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: space.xs,
  },
  footerLink: { alignSelf: 'flex-start', paddingVertical: space.xs },
  footerLinkHovered: { opacity: 0.7 },
  footerLinkText: { fontSize: font.body, color: colors.muted },
  copyright: {
    fontSize: font.small,
    color: colors.muted,
    paddingTop: space.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
}));
