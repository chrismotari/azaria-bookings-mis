import { Image, View } from 'react-native';

import { colors, createStyles } from '../theme';
import { Icon } from './Icon';

/** A cover photo, or a neutral placeholder with an icon. */
export function CoverImage({ url, height }: { url: string | null | undefined; height: number }) {
  if (url) {
    return <Image source={{ uri: url }} style={[styles.cover, { height }]} resizeMode="cover" accessible={false} />;
  }
  return (
    <View style={[styles.cover, styles.placeholder, { height }]}>
      <Icon name="image-outline" size={32} color={colors.light} />
    </View>
  );
}

const styles = createStyles(() => ({
  cover: { width: '100%', backgroundColor: colors.neutralTint },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
}));
