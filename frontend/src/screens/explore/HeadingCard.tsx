import { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { OnBar } from '../../components/Field';
import { colors, createStyles, font, radius, space, useIsWide, weight } from '../../theme';

/** Every heading card's height on wide screens: a headline and two rows of inputs. */
const HEIGHT = 280;

type Props = {
  title: string;
  children: ReactNode;
  /** False where the page has its own headings (the website's sample screen). */
  heading?: boolean;
  /** Defaults to the screen's width. */
  compact?: boolean;
};

/** The bar-coloured card that opens each Explore tab: a large headline over the tab's search or tiles. */
export function HeadingCard({ title, children, heading = true, compact }: Props) {
  const wide = useIsWide();
  const narrow = compact ?? !wide;
  return (
    <View style={[styles.card, narrow ? styles.cardCompact : styles.fixed]}>
      <Text
        style={[styles.headline, narrow && styles.headlineCompact]}
        accessibilityRole={heading ? 'header' : undefined}
        numberOfLines={narrow ? undefined : 1}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

/** The search fields' block on a heading card, in the theme's hover shade. */
export function SearchPanel({ children }: { children: ReactNode }) {
  return (
    <OnBar>
      <View style={styles.panel}>{children}</View>
    </OnBar>
  );
}

const styles = createStyles(() => ({
  card: {
    backgroundColor: colors.bar,
    borderWidth: 1,
    borderColor: colors.barEdge,
    borderRadius: radius.lg,
    padding: space.xl,
    gap: space.lg,
  },
  cardCompact: { padding: space.lg, gap: space.md },
  fixed: { height: HEIGHT, justifyContent: 'center' },
  headline: { fontSize: font.heading, fontWeight: weight.heavy, color: colors.barText },
  headlineCompact: { fontSize: font.body },
  panel: { backgroundColor: colors.barHover, borderRadius: radius.md, padding: space.lg, gap: space.md },
}));
