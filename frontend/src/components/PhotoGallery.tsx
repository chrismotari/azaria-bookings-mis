import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';

import { createStyles, radius, space, useIsWide } from '../theme';
import { CoverImage } from './CoverImage';
import { Dialog } from './Dialog';
import { PressState } from './pressState';

/** The cover large and the rest as thumbnails; tapping one opens it large. */
export function PhotoGallery({ title, photos }: { title: string; photos: { id: string; url: string }[] }) {
  const isWide = useIsWide();
  const [open, setOpen] = useState<string | null>(null);
  const [cover, ...rest] = photos;
  if (!cover) {
    return <CoverImage url={null} height={isWide ? 280 : 200} />;
  }
  const photo = (url: string, label: string, style: object) => (
    <Pressable
      key={url}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => setOpen(url)}
      style={({ hovered }: PressState) => [style, hovered && styles.photoHovered]}
    >
      <Image source={{ uri: url }} style={styles.image} resizeMode="cover" />
    </Pressable>
  );
  return (
    <View style={styles.gallery}>
      {photo(cover.url, 'Open the cover photo', [styles.coverPhoto, { height: isWide ? 360 : 220 }])}
      {rest.length ? (
        <View style={styles.thumbs}>
          {rest.map((item, index) => photo(item.url, `Open photo ${index + 2}`, styles.thumb))}
        </View>
      ) : null}
      {open ? (
        <Dialog open title={title} size="wide" onClose={() => setOpen(null)} footer={null}>
          <Image source={{ uri: open }} style={styles.large} resizeMode="contain" accessibilityLabel="Photo" />
        </Dialog>
      ) : null}
    </View>
  );
}

const styles = createStyles(() => ({
  gallery: { gap: space.sm },
  coverPhoto: { width: '100%', borderRadius: radius.lg, overflow: 'hidden' },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  thumb: { width: 96, height: 72, borderRadius: radius.md, overflow: 'hidden' },
  photoHovered: { opacity: 0.85 },
  image: { width: '100%', height: '100%' },
  large: { width: '100%', height: 520 },
}));
