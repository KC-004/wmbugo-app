import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import type { ActivityRow } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { useToast } from '../../shared/feedback/ToastHost';
import { invalidateForEvent } from '../../shared/queryClient';
import { useOpenAddWith } from '../add/useOpenAdd';
import { editSpecOf, realTransactionApi, type TransactionApi } from './transactionApi';

/** What a row can do without opening it: open its detail, Delete (Reject for a captured entry), Recategorise. */
export function useEntryActions(api: TransactionApi = realTransactionApi) {
  const nav = useNavigation<{ navigate: (s: 'TransactionDetail' | 'ReviewQueue', p: { transactionId: string } | { focusId: string }) => void }>();
  const toast = useToast();
  const qc = useQueryClient();
  const openAdd = useOpenAddWith();

  const open = useCallback((transactionId: string) => nav.navigate('TransactionDetail', { transactionId }), [nav]);

  const review = useCallback((focusId: string) => nav.navigate('ReviewQueue', { focusId }), [nav]);

  const remove = useCallback(
    async (row: ActivityRow) => {
      const kind = row.captured ? 'reject' : 'delete';
      const r = await api.remove(row.id, kind).catch(() => ({ ok: false as const, code: 'FAILED' }));
      if (!r.ok) return toast.show({ message: r.code === 'ENTRY_REMOVED' ? copy.detail.removedError : copy.duplicate.failed });
      const snapshot = r.value.snapshot;
      await invalidateForEvent(qc, 'TransactionsChanged');
      toast.show({
        message: kind === 'delete' ? copy.detail.deleted : copy.detail.rejected,
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
    },
    [api, toast, qc],
  );

  const recategorise = useCallback(
    async (row: ActivityRow) => {
      const data = await api.load(row.id).catch(() => null);
      if (!data || data === 'missing' || data.detail.removed) return toast.show({ message: copy.detail.removedError });
      const spec = editSpecOf(data.detail);
      if (spec) openAdd(undefined, spec);
    },
    [api, toast, openAdd],
  );

  return { open, review, remove, recategorise };
}
