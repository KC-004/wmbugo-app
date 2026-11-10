import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { PurgeFacts } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { useSheet } from '../../shared/feedback/SheetHost';
import { useToast } from '../../shared/feedback/ToastHost';
import { invalidateForEvent } from '../../shared/queryClient';
import { requireReauth } from '../../shared/reauth';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { realDeletedApi, type DeletedApi } from './deletedApi';

function PermanentDeleteSheet({ facts, onConfirm, close }: { facts: PurgeFacts; onConfirm: () => void; close: () => void }) {
  const theme = useTheme();
  const ink = { color: theme.color('on-glass-primary') };
  return (
    <View testID="purge-sheet" style={styles.sheet}>
      <Text style={[textStyle('body-medium'), ink]}>{copy.deleted.purgeTitle}</Text>
      {facts.isTransfer ? <Text style={[textStyle('body'), ink]}>{copy.deleted.purgeTransfer}</Text> : null}
      {facts.hasRefund ? <Text style={[textStyle('body'), ink]}>{copy.deleted.purgeRefund}</Text> : null}
      <Button label={copy.deleted.deletePermanently} testID="purge-confirm" onPress={onConfirm} />
      <Button label={copy.common.cancel} variant="text" onGlass onPress={close} testID="purge-cancel" />
    </View>
  );
}

/**
 * Delete permanently: a confirm sheet that states the consequence in plain words, then the shared re-authentication guard,
 * then the Story 3.12 purge (which leaves a tombstone). There is no Undo: that is what the sheet is for.
 */
export function usePermanentDelete(api: Pick<DeletedApi, 'purgeFacts' | 'purge'> = realDeletedApi): (transactionId: string, after?: () => void) => void {
  const sheet = useSheet();
  const toast = useToast();
  const qc = useQueryClient();
  return useCallback(
    (transactionId, after) => {
      void api
        .purgeFacts(transactionId)
        .then((facts) =>
          sheet.open({
            id: 'purge',
            title: copy.deleted.deletePermanently,
            body: (close) => (
              <PermanentDeleteSheet
                facts={facts}
                close={close}
                onConfirm={() => {
                  close();
                  void (async () => {
                    if (!(await requireReauth())) return;
                    const r = await api.purge(transactionId).catch(() => ({ ok: false }));
                    if (!r.ok) return toast.show({ message: copy.deleted.purgeFailed });
                    await invalidateForEvent(qc, 'TransactionsChanged');
                    toast.show({ message: copy.deleted.purged });
                    after?.();
                  })();
                }}
              />
            ),
          }),
        )
        .catch(() => toast.show({ message: copy.deleted.purgeFailed }));
    },
    [api, sheet, toast, qc],
  );
}

const styles = StyleSheet.create({ sheet: { gap: 12 } });
