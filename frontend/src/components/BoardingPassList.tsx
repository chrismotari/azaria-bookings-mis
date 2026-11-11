import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '../api/errors';
import { BoardingPass } from '../api/types';
import { colors, font, radius, space, weight } from '../theme';
import { openBoardingPass } from '../utils/download';
import { formatDateTime } from '../utils/format';
import { Button } from './Button';
import { FormError } from './Field';
import { Icon } from './Icon';

type Props = {
  passes: BoardingPass[];
  /** Shows a Delete button on each pass. */
  onDelete?: (boardingPass: BoardingPass) => void;
  deletingId?: string | null;
};

/** Opening a pass works on web only. */
export function BoardingPassList({ passes, onDelete, deletingId }: Props) {
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (boardingPass: BoardingPass) => {
    setError(null);
    setOpeningId(boardingPass.id);
    try {
      await openBoardingPass(boardingPass.id, boardingPass.original_name);
    } catch (openError) {
      setError(errorMessage(openError));
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <View style={styles.list}>
      {passes.map((boardingPass) => (
        <View key={boardingPass.id} style={styles.row}>
          <View style={styles.fileIcon}>
            <Icon
              name={boardingPass.original_name.toLowerCase().endsWith('.pdf') ? 'document-text-outline' : 'image-outline'}
              size={20}
              color={colors.primary}
            />
          </View>
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1}>
              {boardingPass.original_name}
            </Text>
            <Text style={styles.muted}>Uploaded {formatDateTime(boardingPass.uploaded_at)}</Text>
          </View>
          <View style={styles.actions}>
            {Platform.OS === 'web' ? (
              <Button
                title="Open"
                icon="open-outline"
                variant="secondary"
                onPress={() => open(boardingPass)}
                loading={openingId === boardingPass.id}
              />
            ) : null}
            {onDelete ? (
              <Button
                title="Delete"
                variant="danger"
                onPress={() => onDelete(boardingPass)}
                loading={deletingId === boardingPass.id}
              />
            ) : null}
          </View>
        </View>
      ))}
      {Platform.OS !== 'web' ? (
        <Text style={styles.muted}>Opening boarding passes is available on the web app.</Text>
      ) : null}
      <FormError message={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  fileIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, flexBasis: 160, minWidth: 0 },
  name: { color: colors.text, fontWeight: weight.semibold },
  muted: { color: colors.muted, fontSize: font.small },
  actions: { flexDirection: 'row', gap: 8 },
});
