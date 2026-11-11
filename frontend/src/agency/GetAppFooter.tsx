import { useNavigation } from '@react-navigation/native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { IS_NATIVE, IS_PLATFORM } from '../config';
import { Icon } from '../components/Icon';
import { colors, font, space, weight } from '../theme';

/** The footer of an agency site's public pages (web): its "Get the app" link. */
export function GetAppFooter() {
  const navigation = useNavigation();
  if (IS_NATIVE || IS_PLATFORM) {
    return null;
  }
  return (
    <View style={styles.footer}>
      <Pressable accessibilityRole="link" onPress={() => navigation.navigate('GetApp')} style={styles.link}>
        <Icon name="phone-portrait-outline" size={16} color={colors.primary} />
        <Text style={styles.linkText}>Get the app</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.lg,
    alignItems: 'center',
  },
  link: { flexDirection: 'row', alignItems: 'center', gap: space.xs, padding: space.xs },
  linkText: { color: colors.primary, fontSize: font.body, fontWeight: weight.semibold },
});
