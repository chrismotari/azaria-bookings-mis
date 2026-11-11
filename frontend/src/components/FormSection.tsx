import { ReactNode } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';

import { colors, font, radius, shadow, space, weight } from '../theme';
import { Card } from './Card';

type SectionProps = {
  title: string;
  description?: string;
  /** Plain draws the section without its own card (a section inside another card). */
  plain?: boolean;
  children: ReactNode;
};

export function FormSection({ title, description, plain, children }: SectionProps) {
  const content = (
    <>
      <View style={styles.heading}>
        <Text style={[styles.title, plain && styles.titlePlain]}>{title}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      {children}
    </>
  );
  return plain ? <View style={styles.plain}>{content}</View> : <Card>{content}</Card>;
}

/** Stays at the bottom of the view while scrolling (web). */
export function FormFooter({ children }: { children: ReactNode }) {
  return <View style={styles.footer}>{children}</View>;
}

const styles = StyleSheet.create({
  heading: { gap: 2, paddingBottom: space.xs },
  title: { fontSize: font.heading, fontWeight: weight.bold, color: colors.text },
  titlePlain: { fontSize: font.body },
  description: { fontSize: font.small, color: colors.muted },
  plain: { gap: space.md },
  footer: {
    position: 'sticky',
    bottom: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadow,
  } as unknown as ViewStyle,
});
