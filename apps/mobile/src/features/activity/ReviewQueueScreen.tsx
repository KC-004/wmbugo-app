import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { parseAmountInput, sourceWords, type ReviewItem, type ReviewSide } from '@wmbugo/core';
import { announce } from '../../shared/a11y/announce';
import { copy } from '../../shared/copy';
import { currencySymbol } from '../../shared/currencySymbol';
import { minorToInput } from '../../shared/minorInput';
import { ErrorBlock, Reveal, Skeleton } from '../../shared/feedback/Feedback';
import { useToast } from '../../shared/feedback/ToastHost';
import { PaperBoat } from '../../shared/brand/PaperBoat';
import { invalidateForEvent } from '../../shared/queryClient';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { Chip } from '../../shared/ui/Chip';
import { ScreenHeader } from '../shell/ScreenHeader';
import { realAddApi, type AddApi } from '../add/addApi';
import { HeldRowActions } from './HeldRowActions';
import { REVIEW_QUEUE_KEY, realReviewQueueApi, type ReviewApi, type ReviewData } from './reviewApi';

const ALL_CHECKED_MS = 4000;
const SOURCE_COPY = { addedByYou: copy.review.addedByYou, bankSms: copy.review.bankSms, receipt: copy.review.receipt, csvImport: copy.review.csvImport, other: copy.review.otherSource } as const;

/** "7 Nov, 9:12 pm" (UTC clock of the device; the queue shows when the money moved, close enough for side-by-side). */
function whenText(ms: number): string {
  const d = new Date(ms);
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(d);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(d).toLowerCase();
  return `${day}, ${time}`;
}

/**
 * The review queue (SCR-10): everything waiting for a decision, newest first, with the evidence side by side, and the
 * entries that still need a category in their own section. Every action offers Undo and updates the dot and totals.
 */
export function ReviewQueueScreen({
  focusId,
  onBack,
  onEdit,
  api = realReviewQueueApi,
  duplicateApi = realAddApi,
}: {
  focusId?: string;
  onBack: () => void;
  /** Opens the entry's detail to edit it. */
  onEdit: (transactionId: string) => void;
  api?: ReviewApi;
  duplicateApi?: Pick<AddApi, 'duplicateInfo' | 'keepBoth' | 'merge' | 'undoResolution'>;
}) {
  const theme = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: REVIEW_QUEUE_KEY, queryFn: () => api.load() });
  const data = q.data ?? null;
  const [cleared, setCleared] = useState(false);
  const hadItems = useRef(false);
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const positions = useRef(new Map<string, number>());
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // "All checked" for a few seconds after the last item is resolved.
  useEffect(() => {
    if (!data) return;
    if (data.items.length > 0) {
      hadItems.current = true;
      setCleared(false);
      return;
    }
    if (hadItems.current) {
      hadItems.current = false;
      setCleared(true);
      announce(copy.review.allChecked);
      const h = setTimeout(() => setCleared(false), ALL_CHECKED_MS);
      return () => clearTimeout(h);
    }
  }, [data?.items.length]);

  // Opens scrolled to the item that was tapped.
  useEffect(() => {
    if (!focusId || !data) return;
    const y = positions.current.get(focusId);
    if (y !== undefined) scroller.current?.scrollTo({ y: Math.max(0, y - 8), animated: false });
  }, [focusId, data?.items.length]);

  const refresh = () => invalidateForEvent(qc, 'TransactionsChanged');

  const run = async (act: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await act();
    } finally {
      busy.current = false;
    }
  };

  const decide = (id: string, message: string, call: () => ReturnType<ReviewApi['approve']>) =>
    run(async () => {
      const r = await call().catch(() => ({ ok: false as const, code: 'FAILED' }));
      if (!r.ok) return setError(copy.review.actionFailed);
      const snapshot = r.value.snapshot;
      await refresh();
      toast.show({
        message,
        undo: {
          label: copy.common.undo,
          onUndo: () =>
            void (message === copy.detail.deleted || message === copy.detail.rejected ? api.restore(snapshot) : api.undoDecision(snapshot))
              .then(refresh)
              .catch(() => toast.show({ message: copy.add.removeFailed })),
        },
      });
      void id;
    });

  const assign = (id: string, categoryId: string) =>
    run(async () => {
      const r = await api.assignCategory(id, categoryId).catch(() => ({ ok: false as const, code: 'FAILED' }));
      if (!r.ok || r.value.previous.length === 0) return setError(copy.review.actionFailed);
      const previous = r.value.previous;
      await refresh();
      toast.show({
        message: copy.review.categorised,
        undo: { label: copy.common.undo, onUndo: () => void api.undoCategory(previous).then(refresh).catch(() => toast.show({ message: copy.add.removeFailed })) },
      });
    });

  const header = <ScreenHeader title={data ? copy.review.title.replace('{n}', String(data.items.length)) : copy.review.titleLoading} onBack={onBack} backTestID="review-back" />;

  let body = null;
  if (data) {
    const empty = data.items.length === 0 && data.needsCategory.length === 0;
    body = (
      <ScrollView ref={scroller} contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled" testID="review-list">
        {cleared ? (
          <View testID="review-all-checked" accessibilityLiveRegion="polite" style={styles.center}>
            <PaperBoat />
            <Text style={[textStyle('title-sm'), { color: theme.color('text-primary') }]}>{copy.review.allChecked}</Text>
          </View>
        ) : null}
        {empty && !cleared ? (
          <View testID="review-empty" style={styles.center}>
            <PaperBoat />
            <Text style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{copy.review.caughtUp}</Text>
          </View>
        ) : null}
        {error ? (
          <Text testID="review-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>
            {error}
          </Text>
        ) : null}
        {data.items.map((item) => (
          <View key={item.id} testID={`review-item-${item.id}`} onLayout={(e) => positions.current.set(item.id, e.nativeEvent.layout.y)}>
            <ReviewCard
              item={item}
              data={data}
              duplicateApi={duplicateApi}
              onApprove={() => void decide(item.id, copy.review.approved, () => api.approve(item.id))}
              onEdit={() => onEdit(item.id)}
              onRemove={() => {
                const kind = item.sourceKind === 'manual' ? 'delete' : 'reject';
                void decide(item.id, kind === 'delete' ? copy.detail.deleted : copy.detail.rejected, () => api.remove(item.id, kind));
              }}
              onConfirmForeign={(amountMinor, accountId) => void decide(item.id, copy.review.approved, () => api.confirmForeign(item.id, amountMinor, accountId))}
            />
          </View>
        ))}
        {data.needsCategory.length > 0 ? (
          <View testID="review-needs-category" style={styles.section}>
            <Text accessibilityRole="header" style={[textStyle('title-sm'), { color: theme.color('text-primary') }]}>{copy.review.addCategory}</Text>
            {data.needsCategory.map((e) => (
              <NeedsCategoryRow key={e.id} entry={e} data={data} onPick={(categoryId) => void assign(e.id, categoryId)} />
            ))}
          </View>
        ) : null}
      </ScrollView>
    );
  }

  return (
    <View style={styles.fill}>
      {header}
      <Reveal
        loading={q.isLoading}
        skeleton={
          <View style={styles.pad} testID="review-skeleton">
            <Skeleton height={120} />
            <Skeleton height={120} />
          </View>
        }
        fill>
        {body ?? (q.isError || q.data === null ? <View style={styles.pad}><ErrorBlock cause={copy.review.loadError} onRetry={() => void q.refetch()} /></View> : null)}
      </Reveal>
    </View>
  );
}

function SideColumn({ title, side, data }: { title: string; side: ReviewSide; data: ReviewData }) {
  const theme = useTheme();
  const ink = { color: theme.color('text-primary') };
  const muted = { color: theme.color('text-secondary') };
  return (
    <View testID={`review-side-${title}`} style={styles.side}>
      <Text style={[textStyle('label'), muted]}>{title}</Text>
      <Amount amountMinor={side.amountMinor} currency={data.currency} direction="neutral" locale={data.locale} />
      <Text style={[textStyle('body'), ink]}>{whenText(side.occurredAtMs)}</Text>
      {side.merchant ? <Text style={[textStyle('body-medium'), ink]}>{side.merchant}</Text> : null}
      {side.account ? <Text style={[textStyle('body'), muted]}>{side.account}</Text> : null}
      {side.category ? <Text style={[textStyle('body'), muted]}>{side.category}</Text> : null}
      <Text style={[textStyle('caption'), muted]}>{SOURCE_COPY[sourceWords(side.sourceKind)]}</Text>
    </View>
  );
}

function ReviewCard({
  item,
  data,
  duplicateApi,
  onApprove,
  onEdit,
  onRemove,
  onConfirmForeign,
}: {
  item: ReviewItem;
  data: ReviewData;
  duplicateApi: Pick<AddApi, 'duplicateInfo' | 'keepBoth' | 'merge' | 'undoResolution'>;
  onApprove: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onConfirmForeign: (amountMinor: number, accountId: string) => void;
}) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const [text, setText] = useState('');
  const [accountId, setAccountId] = useState<string | null>(data.accounts[0]?.id ?? null);
  const captured = item.sourceKind !== 'manual';
  const removeLabel = captured ? copy.detail.reject : copy.detail.delete;
  const symbol = currencySymbol(data.currency, data.locale);
  const parsed = parseAmountInput(text, data.exponent);
  const typed = parsed.ok && parsed.value > 0 ? parsed.value : null;
  const card = [styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }];

  if (item.reason === 'duplicate' && item.alreadyRecorded) {
    return (
      <View style={card}>
        <View style={[styles.sides, fontScale >= 1.3 ? styles.column : styles.rowDir]}>
          <SideColumn title={copy.review.thisEntry} side={item} data={data} />
          <SideColumn title={copy.review.alreadyRecorded} side={item.alreadyRecorded} data={data} />
        </View>
        <View style={styles.actions}>
          <HeldRowActions transactionId={item.id} api={duplicateApi} />
          <Button label={removeLabel} variant="text" onPress={onRemove} testID={`review-remove-${item.id}`} />
        </View>
      </View>
    );
  }

  if (item.foreign) {
    const f = item.foreign;
    return (
      <View style={card}>
        <Text style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{item.merchant ?? ''}</Text>
        <Text testID={`review-foreign-${item.id}`} style={[textStyle('headline'), { color: theme.color('text-primary') }]}>{`${f.currency} ${minorToInput(f.amountMinor, f.exponent)}`}</Text>
        <Text style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{copy.review.amountCharged.replace('{symbol}', symbol)}</Text>
        <TextInput
          testID={`review-amount-${item.id}`}
          value={text}
          onChangeText={setText}
          keyboardType="decimal-pad"
          accessibilityLabel={copy.review.amountCharged.replace('{symbol}', symbol)}
          style={[textStyle('body'), styles.input, { color: theme.color('text-primary'), borderColor: theme.color('border-control') }]}
        />
        <Text style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{copy.review.chargedTo}</Text>
        <View style={styles.chips}>
          {data.accounts.map((a) => (
            <Chip key={a.id} label={a.name} variant="account" testID={`review-account-${item.id}-${a.id}`} selected={accountId === a.id} onPress={() => setAccountId(a.id)} />
          ))}
        </View>
        <View style={styles.actions}>
          <Button
            label={copy.review.confirm}
            testID={`review-confirm-${item.id}`}
            disabledReason={typed === null ? copy.review.enterAmount.replace('{symbol}', symbol) : accountId === null ? copy.review.noAccount : undefined}
            onPress={() => typed !== null && accountId !== null && onConfirmForeign(typed, accountId)}
          />
          <Button label={removeLabel} variant="text" onPress={onRemove} testID={`review-remove-${item.id}`} />
        </View>
      </View>
    );
  }

  return (
    <View style={card}>
      <SideColumn title={copy.review.thisEntry} side={item} data={data} />
      <View style={styles.actions}>
        <Button label={copy.review.approve} onPress={onApprove} testID={`review-approve-${item.id}`} />
        <Button label={copy.review.edit} variant="secondary" onPress={onEdit} testID={`review-edit-${item.id}`} />
        <Button label={removeLabel} variant="text" onPress={onRemove} testID={`review-remove-${item.id}`} />
      </View>
    </View>
  );
}

function NeedsCategoryRow({ entry, data, onPick }: { entry: ReviewSide; data: ReviewData; onPick: (categoryId: string) => void }) {
  const theme = useTheme();
  const kindOf = entry.category === null ? 'expense' : (data.categories.find((c) => c.name === entry.category)?.kind ?? 'expense');
  const choices = data.categories.filter((c) => c.kind === kindOf && c.id !== 'cat_uncategorised').slice(0, 8);
  return (
    <View testID={`review-cat-${entry.id}`} style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <View style={styles.between}>
        <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{entry.merchant ?? copy.review.noMerchant}</Text>
        <Amount amountMinor={entry.amountMinor} currency={data.currency} direction="neutral" locale={data.locale} />
      </View>
      <View style={styles.chips}>
        {choices.map((c) => (
          <Chip key={c.id} label={c.name} testID={`review-cat-${entry.id}-${c.id}`} onPress={() => onPick(c.id)} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: 16, gap: 12 },
  center: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  section: { gap: 12, paddingTop: 8 },
  card: { borderWidth: 1, borderRadius: radii.md, padding: 16, gap: 8 },
  sides: { gap: 16 },
  rowDir: { flexDirection: 'row' },
  column: { flexDirection: 'column' },
  side: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  input: { borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 12, minHeight: 48 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
