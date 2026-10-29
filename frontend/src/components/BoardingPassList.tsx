import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '../api/errors';
import { BoardingPass } from '../api/types';
import { colors } from '../theme';
import { downloadBoardingPass } from '../utils/download';
import { formatDateTime } from '../utils/format';
import { Button } from './Button';
import { FormError } from './Field';

type Props = {
  passes: BoardingPass[];
  /** Shows a Delete button on each pass. */
  onDelete?: (boardingPass: BoardingPass) => void;
  deletingId?: number | null;
};

/** Boarding passes with a Download button each (web only), and optionally Delete. */
export function BoardingPassList({ passes, onDelete, deletingId }: Props) {
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = async (boardingPass: BoardingPass) => {
    setError(null);
    setDownloadingId(boardingPass.id);
    try {
      await downloadBoardingPass(boardingPass.id, boardingPass.original_name);
    } catch (downloadError) {
      setError(errorMessage(downloadError));
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <View style={styles.list}>
      {passes.map((boardingPass) => (
        <View key={boardingPass.id} style={styles.row}>
          <View style={styles.info}>
            <Text style={styles.name}>{boardingPass.original_name}</Text>
            <Text style={styles.muted}>Uploaded {formatDateTime(boardingPass.uploaded_at)}</Text>
          </View>
          <View style={styles.actions}>
            {Platform.OS === 'web' ? (
              <Button
                title="Download"
                variant="secondary"
                onPress={() => download(boardingPass)}
                loading={downloadingId === boardingPass.id}
              />
            ) : null}
            {onDelete ? (
              <Button
                title="Delete"
                variant="secondary"
                onPress={() => onDelete(boardingPass)}
                loading={deletingId === boardingPass.id}
              />
            ) : null}
          </View>
        </View>
      ))}
      {Platform.OS !== 'web' ? (
        <Text style={styles.muted}>Downloading boarding passes is available on the web app.</Text>
      ) : null}
      <FormError message={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  info: { flexShrink: 1, minWidth: 0 },
  name: { color: colors.text, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: 13 },
  actions: { flexDirection: 'row', gap: 8 },
});
