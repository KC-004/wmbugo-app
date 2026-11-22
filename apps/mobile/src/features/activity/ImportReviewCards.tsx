import { useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { ReviewItem, ReviewSide } from '@wmbugo/core';
import { spokenAmount } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { useToast } from '../../shared/feedback/ToastHost';
import { invalidateForEvent } from '../../shared/queryClient';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';
import type { ReviewApi, ReviewData } from './reviewApi';
import { shortDate, SideColumn } from './reviewParts';

/** What TalkBack hears for a pair: the whole sentence as one node, then the two buttons. */
export function transferSpoken(out: ReviewSide, into: ReviewSide, data: ReviewData): string {
  return copy.review.transferSpoken
    .replace('{out}', spokenAmount(out.amountMinor, data.currency, data.locale))
    .replace('{from}', out.account ?? '')
    .replace('{fromDate}', shortDate(out.occurredAtMs))
    .replace('{in}', spokenAmount(into.amountMinor, data.currency, data.locale))
    .replace('{to}', into.account ?? '')
    .replace('{toDate}', shortDate(into.occurredAtMs));
}

/** The question and the two choices, with the two legs side by side (stacked at large text). Story 9.5. */
export function TransferPairCard({ item, other, data, onLink, onSeparate }: { item: ReviewItem; other: ReviewSide; data: ReviewData; onLink: () => void; onSeparate: () => void }) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const out = item.eventType === 'expense' ? item : other;
  const into = item.eventType === 'expense' ? other : item;
  return (
    <View style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <View accessible accessibilityLabel={transferSpoken(out, into, data)} testID={'review-pair-' + item.id} style={[styles.sides, fontScale >= 1.3 ? styles.column : styles.row]}>
        <SideColumn title={copy.review.moneyOut} side={out} data={data} />
        <SideColumn title={copy.review.moneyIn} side={into} data={data} />
      </View>
      <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{copy.review.transferQuestion}</Text>
      <View style={styles.actions}>
        <Button label={copy.review.yesTransfer} onPress={onLink} testID={'review-link-' + item.id} />
        <Button label={copy.review.noSeparate} variant="secondary" onPress={onSeparate} testID={'review-separate-' + item.id} />
      </View>
    </View>
  );
}

/** A row from a day its file covers only partly, with what is already recorded that day. Add it, It's already here, Edit. */
export function EdgeDayCard({
  item,
  entries,
  data,
  onAdd,
  onLink,
  onEdit,
}: {
  item: ReviewItem;
  entries: readonly ReviewSide[];
  data: ReviewData;
  onAdd: () => void;
  /** `existingId` is the chosen entry, or nothing when the row is just skipped. */
  onLink: (existingId?: string) => void;
  onEdit: () => void;
}) {
  const theme = useTheme();
  const [choosing, setChoosing] = useState(false);
  return (
    <View style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <SideColumn title={copy.review.thisEntry} side={item} data={data} />
      <Text testID={'review-partly-' + item.id} style={[textStyle('body'), { color: theme.color('text-primary') }]}>
        {copy.review.partlyCovered.replace('{date}', shortDate(item.occurredAtMs))}
      </Text>
      {entries.length > 0 ? (
        <View testID={'review-day-' + item.id} style={styles.list}>
          <Text style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{copy.review.recordedThatDay}</Text>
          {entries.map((e) => (
            <SideColumn key={e.id} title={e.merchant ?? copy.review.noMerchant} side={e} data={data} />
          ))}
        </View>
      ) : null}
      {choosing ? (
        <View style={styles.list}>
          <Text style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{copy.review.pickEntry}</Text>
          <View style={styles.chips}>
            {entries.map((e) => (
              <Chip key={e.id} label={e.merchant ?? copy.review.noMerchant} testID={'review-here-' + item.id + '-' + e.id} onPress={() => onLink(e.id)} />
            ))}
            <Chip label={copy.review.justSkip} testID={'review-skip-' + item.id} onPress={() => onLink()} />
          </View>
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button label={copy.review.addIt} onPress={onAdd} testID={'review-add-' + item.id} />
        <Button
          label={copy.review.alreadyHere}
          variant="secondary"
          testID={'review-already-' + item.id}
          // One entry on that day is the obvious one; with none the row is just skipped; with several the person picks.
          onPress={() => (entries.length === 1 ? onLink(entries[0]!.id) : entries.length === 0 ? onLink() : setChoosing((c) => !c))}
        />
        <Button label={copy.review.edit} variant="text" onPress={onEdit} testID={'review-edit-' + item.id} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radii.md, padding: 16, gap: 8 },
  sides: { gap: 16 },
  row: { flexDirection: 'row' },
  column: { flexDirection: 'column' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  list: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});

type DurableApi = Pick<ReviewApi, 'approve' | 'undoDecision' | 'linkTransfer' | 'keepSeparate' | 'linkEdgeDay' | 'undoImport'>;

/**
 * The same question and buttons as the review queue, on the entry itself (Story 9.5, the durable path). A transfer pair asks whether
 * the money moved between your accounts; a row from a partly covered day can be added or skipped as already recorded (choosing
 * which recorded entry it is stays in the review queue, where they are listed).
 */
export function ImportReviewActions({ transactionId, reason, whenMs, api }: { transactionId: string; reason: 'transfer_pair' | 'edge_day'; whenMs: number; api: DurableApi }) {
  const theme = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const refresh = () => invalidateForEvent(qc, 'TransactionsChanged');
  const run = async (message: string, call: () => Promise<{ ok: boolean }>, undo: () => Promise<{ ok: boolean }>) => {
    const r = await call().catch(() => ({ ok: false }));
    if (!r.ok) return toast.show({ message: copy.review.actionFailed });
    await refresh();
    toast.show({ message, undo: { label: copy.common.undo, onUndo: () => void undo().then(refresh).catch(() => toast.show({ message: copy.add.removeFailed })) } });
  };
  const ink = { color: theme.color('text-primary') };
  if (reason === 'transfer_pair') {
    return (
      <View testID="detail-import-review" style={styles.list}>
        <Text style={[textStyle('body-medium'), ink]}>{copy.review.transferQuestion}</Text>
        <View style={styles.actions}>
          <Button label={copy.review.yesTransfer} onPress={() => void run(copy.review.linkedTransfer, () => api.linkTransfer(transactionId), () => api.undoImport(transactionId))} testID="detail-link-transfer" />
          <Button label={copy.review.noSeparate} variant="secondary" onPress={() => void run(copy.review.keptSeparate, () => api.keepSeparate(transactionId), () => api.undoImport(transactionId))} testID="detail-keep-separate" />
        </View>
      </View>
    );
  }
  return (
    <View testID="detail-import-review" style={styles.list}>
      <Text style={[textStyle('body-medium'), ink]}>{copy.review.partlyCovered.replace('{date}', shortDate(whenMs))}</Text>
      <View style={styles.actions}>
        <Button
          label={copy.review.addIt}
          onPress={() =>
            void api.approve(transactionId).then(
              (r) => {
                if (!r.ok) return toast.show({ message: copy.review.actionFailed });
                const snapshot = r.value.snapshot;
                return refresh().then(() => toast.show({ message: copy.review.approved, undo: { label: copy.common.undo, onUndo: () => void api.undoDecision(snapshot).then(refresh) } }));
              },
              () => toast.show({ message: copy.review.actionFailed }),
            )
          }
          testID="detail-add-edge"
        />
        <Button label={copy.review.alreadyHere} variant="secondary" onPress={() => void run(copy.review.alreadyHere, () => api.linkEdgeDay(transactionId), () => api.undoImport(transactionId))} testID="detail-already-here" />
      </View>
    </View>
  );
}
