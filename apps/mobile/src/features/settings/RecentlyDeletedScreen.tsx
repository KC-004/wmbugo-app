import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { shortDate, type DeletedRow } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { ErrorBlock, Reveal, Skeleton } from '../../shared/feedback/Feedback';
import { useToast } from '../../shared/feedback/ToastHost';
import { PaperBoat } from '../../shared/brand/PaperBoat';
import { invalidateForEvent } from '../../shared/queryClient';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { DELETED_QUERY_KEY, realDeletedApi, type DeletedApi, type DeletedData } from '../activity/deletedApi';
import { usePermanentDelete } from '../activity/usePermanentDelete';

/** Settings › Data › Recently deleted: manual entries deleted in the last 30 days, with Restore and Delete permanently. */
export function RecentlyDeletedScreen({ api = realDeletedApi }: { api?: DeletedApi }) {
  const theme = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: DELETED_QUERY_KEY, queryFn: () => api.load() });
  const purge = usePermanentDelete(api);
  const data = q.data ?? null;
  const refresh = () => invalidateForEvent(qc, 'TransactionsChanged');

  const busy = useRef(false);
  const restore = async (row: DeletedRow) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await restoreOnce(row);
    } finally {
      busy.current = false;
    }
  };
  const restoreOnce = async (row: DeletedRow) => {
    const r = await api.restore(row.id, 'deleted').catch(() => ({ ok: false as const, code: 'FAILED' }));
    if (!r.ok) return toast.show({ message: copy.deleted.restoreFailed });
    const snapshot = r.value.snapshot;
    await refresh();
    toast.show({
      message: copy.deleted.restored,
      undo: { label: copy.common.undo, onUndo: () => void api.undoRestore(snapshot).then(refresh).catch(() => toast.show({ message: copy.add.removeFailed })) },
    });
  };

  const body = (d: DeletedData) =>
    d.rows.length === 0 ? (
      <View testID="deleted-empty" style={styles.empty}>
        <PaperBoat />
        <Text style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{copy.deleted.empty}</Text>
      </View>
    ) : (
      <View style={styles.list}>
        {d.rows.map((row) => (
          <View key={row.id} testID={`deleted-${row.id}`} style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
            <View style={styles.between}>
              <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{row.merchant ?? row.category ?? copy.activity.transfer}</Text>
              <Amount amountMinor={row.amountMinor} currency={d.currency} direction="neutral" locale={d.locale} />
            </View>
            <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{`${shortDate(row.localDate)} · ${(row.daysLeft === 1 ? copy.deleted.dayLeft : copy.deleted.daysLeft).replace('{n}', String(row.daysLeft))}`}</Text>
            <View style={styles.actions}>
              <Button label={copy.deleted.restore} variant="secondary" onPress={() => void restore(row)} testID={`restore-${row.id}`} />
              <Button label={copy.deleted.deletePermanently} variant="text" onPress={() => purge(row.id, () => void refresh())} testID={`purge-${row.id}`} />
            </View>
          </View>
        ))}
      </View>
    );

  return (
    <Reveal
      loading={q.isLoading}
      skeleton={
        <View testID="deleted-skeleton" style={styles.list}>
          <Skeleton height={88} />
          <Skeleton height={88} />
        </View>
      }>
      {data ? body(data) : q.isError || q.data === null ? <ErrorBlock cause={copy.deleted.loadError} onRetry={() => void q.refetch()} /> : null}
    </Reveal>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  card: { borderWidth: 1, borderRadius: radii.md, padding: 16, gap: 6 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
});
