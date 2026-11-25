import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Image, Platform, Text, View } from 'react-native';

import { api } from '../api/client';
import { errorMessage } from '../api/errors';
import { colors, createStyles, font, radius, space } from '../theme';
import { Button } from './Button';
import { FileField } from './FileField';
import { StatusChip } from './StatusChip';

type Photo = { id: string; url: string };

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const PHOTO_TYPES = '.png,.jpg,.jpeg,.webp';

function photoProblem(file: File): string | null {
  if (!/\.(png|jpe?g|webp)$/i.test(file.name)) {
    return `${file.name}: upload a PNG, JPEG or WebP image.`;
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return `${file.name}: the photo is larger than 2 MB.`;
  }
  return null;
}

/** Uploads photos chosen before the item existed; one the server still refuses can be added again later. */
export async function uploadPendingPhotos(path: string, files: File[]) {
  for (const file of files) {
    const form = new FormData();
    form.append('image', file);
    await api.post(path, form).catch(() => undefined);
  }
}

/** A new item's photos, kept here and uploaded once it is created. noun: "tour", "hotel". */
export function PendingPhotos({
  files,
  onChange,
  max,
  noun,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  max: number;
  noun: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const urls = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => urls.forEach((url) => URL.revokeObjectURL(url)), [urls]);
  const move = (index: number, by: number) => {
    const next = [...files];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    onChange(next);
  };
  return (
    <PhotoGrid
      photos={files.map((file, index) => ({ key: `${file.name}-${index}`, url: urls[index] }))}
      max={max}
      onMove={move}
      onDelete={(index) => onChange(files.filter((_, other) => other !== index))}
      onAdd={(added) => {
        const problems = added.map(photoProblem).filter(Boolean);
        setError(problems.length ? problems.join(' ') : null);
        const fine = added.filter((file) => !photoProblem(file));
        const room = max - files.length;
        if (fine.length > room) {
          setError(`A ${noun} can have at most ${max} photos.`);
        }
        onChange([...files, ...fine.slice(0, room)]);
      }}
      error={error}
      busy={false}
    />
  );
}

/** A saved item's photos: each change is saved at once. path: its photos endpoint; queryKey: what to refresh. */
export function SavedPhotos({
  path,
  initial,
  max,
  queryKey,
}: {
  path: string;
  initial: Photo[];
  max: number;
  queryKey: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const [photos, setPhotos] = useState<Photo[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey });
    }
  };
  return (
    <PhotoGrid
      photos={photos.map((photo) => ({ key: photo.id, url: photo.url }))}
      max={max}
      busy={busy}
      error={error}
      onMove={(index, by) =>
        run(async () => {
          const { data } = await api.patch<Photo[]>(`${path}/${photos[index].id}`, { position: index + by });
          setPhotos(data);
        })
      }
      onDelete={(index) =>
        run(async () => {
          await api.delete(`${path}/${photos[index].id}`);
          setPhotos(photos.filter((_, other) => other !== index));
        })
      }
      onAdd={(files) =>
        run(async () => {
          const added: Photo[] = [];
          const failed: string[] = [];
          for (const file of files) {
            const form = new FormData();
            form.append('image', file);
            try {
              added.push((await api.post<Photo>(path, form)).data);
            } catch (failure) {
              failed.push(`${file.name}: ${errorMessage(failure)}`);
            }
          }
          setPhotos((current) => [...current, ...added]);
          if (failed.length) {
            throw new Error(failed.join(' '));
          }
        })
      }
    />
  );
}

type GridProps = {
  photos: { key: string; url: string }[];
  max: number;
  onMove: (index: number, by: number) => void;
  onDelete: (index: number) => void;
  onAdd: (files: File[]) => void;
  error: string | null;
  busy: boolean;
};

function PhotoGrid({ photos, max, onMove, onDelete, onAdd, error, busy }: GridProps) {
  if (Platform.OS !== 'web') {
    return <Text style={styles.muted}>Photos can be changed in the web app.</Text>;
  }
  return (
    <View style={styles.list}>
      <View style={styles.photos}>
        {photos.map((photo, index) => (
          <View key={photo.key} style={styles.photo}>
            <Image source={{ uri: photo.url }} style={styles.photoImage} resizeMode="cover" />
            {index === 0 ? <StatusChip label="Cover" tone="info" /> : null}
            <View style={styles.row}>
              <Button title="Up" variant="link" disabled={busy || index === 0} onPress={() => onMove(index, -1)} />
              <Button
                title="Down"
                variant="link"
                disabled={busy || index === photos.length - 1}
                onPress={() => onMove(index, 1)}
              />
              <Button title="Delete" variant="link" disabled={busy} onPress={() => onDelete(index)} />
            </View>
          </View>
        ))}
      </View>
      <FileField
        label="Add photos"
        hint={`PNG, JPEG or WebP, up to 2 MB each; ${photos.length} of ${max} added.`}
        accept={PHOTO_TYPES}
        onSelect={onAdd}
        disabled={busy || photos.length >= max}
        error={error ?? undefined}
      />
    </View>
  );
}

const styles = createStyles(() => ({
  muted: { fontSize: font.small, color: colors.muted },
  list: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  photo: { width: 160, gap: space.xs },
  photoImage: { width: 160, height: 110, borderRadius: radius.md, backgroundColor: colors.neutralTint },
}));
