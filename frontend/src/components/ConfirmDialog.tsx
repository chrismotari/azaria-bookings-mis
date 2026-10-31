import { createContext, ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { colors, font } from '../theme';
import { Button } from './Button';
import { Dialog } from './Dialog';

type ConfirmOptions = {
  title: string;
  message: string;
  /** The action button's label, e.g. "Cancel booking". */
  confirmLabel: string;
  /** Danger for destructive actions. */
  tone?: 'primary' | 'danger';
};

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

/** Hosts the one confirmation dialog; screens ask through useConfirm. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);

  const confirm = useCallback<Confirm>(
    (next) =>
      new Promise((resolve) => {
        resolver.current = resolve;
        setOptions(next);
      }),
    [],
  );
  const finish = (confirmed: boolean) => {
    resolver.current?.(confirmed);
    resolver.current = null;
    setOptions(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={options !== null}
        title={options?.title ?? ''}
        onClose={() => finish(false)}
        footer={
          <>
            <Button title="Go back" variant="secondary" onPress={() => finish(false)} />
            <Button
              title={options?.confirmLabel ?? ''}
              variant={options?.tone === 'danger' ? 'danger' : 'primary'}
              onPress={() => finish(true)}
            />
          </>
        }
      >
        <Text style={styles.message}>{options?.message}</Text>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

/** Asks the user to confirm an action in a small dialog; resolves true when they confirm. */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error('useConfirm must be used inside ConfirmProvider');
  }
  return confirm;
}

const styles = StyleSheet.create({
  message: { fontSize: font.body, color: colors.text },
});
