import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { copy } from '../../shared/copy';
import { useSheet } from '../../shared/feedback/SheetHost';
import { useToast } from '../../shared/feedback/ToastHost';
import { invalidateForEvent } from '../../shared/queryClient';
import { SplitSheet, type SplitStart } from './SplitSheet';
import { realTransactionApi, type TransactionApi } from './transactionApi';

/**
 * Opens the split editor for an entry. With `newAmountMinor` (an edited amount on an entry that is already split) the
 * rows must add up to that new amount, and the amount changes only together with balanced splits.
 */
export function useOpenSplit(api: TransactionApi = realTransactionApi): (transactionId: string, newAmountMinor?: number) => void {
  const sheet = useSheet();
  const toast = useToast();
  const qc = useQueryClient();
  return useCallback(
    (transactionId: string, newAmountMinor?: number) => {
      void api
        .load(transactionId)
        .then((data) => {
          if (!data || data === 'missing' || data.detail.removed) return toast.show({ message: copy.detail.removedError });
          const total = newAmountMinor ?? data.detail.amountMinor;
          const first = data.splits[0];
          const start: SplitStart = {
            transactionId,
            totalMinor: total,
            currency: data.currency,
            exponent: data.exponent,
            locale: data.locale,
            categories: data.categories,
            // An entry that is not split yet starts with its category and no amount, so the whole total is still to assign.
            rows:
              data.splits.length > 1
                ? data.splits.map((s) => ({ categoryId: s.categoryId, amountMinor: s.amountMinor, notItemised: s.notItemised }))
                : [{ categoryId: first?.categoryId ?? data.categories[0]!.id, amountMinor: null }],
          };
          sheet.open({
            id: 'split',
            title: copy.split.title,
            body: (close) => (
              <SplitSheet
                start={start}
                close={close}
                onSave={async (rows) => {
                  const r = await api.setSplits(transactionId, rows, newAmountMinor);
                  if (!r.ok) return { ok: false, code: r.code };
                  const snapshot = r.value.snapshot;
                  await invalidateForEvent(qc, 'TransactionsChanged');
                  toast.show({
                    message: copy.add.saved,
                    undo: {
                      label: copy.common.undo,
                      onUndo: () =>
                        void api
                          .restore(snapshot)
                          .then(async (u) => {
                            await invalidateForEvent(qc, 'TransactionsChanged');
                            if (!u.ok) toast.show({ message: copy.add.removeFailed });
                          })
                          .catch(() => toast.show({ message: copy.add.removeFailed })),
                    },
                  });
                  return { ok: true };
                }}
              />
            ),
          });
        })
        .catch(() => toast.show({ message: copy.duplicate.failed }));
    },
    [api, sheet, toast, qc],
  );
}
