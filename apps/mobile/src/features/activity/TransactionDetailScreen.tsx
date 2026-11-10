import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowsLeftRight, DotsThree } from 'phosphor-react-native';
import { captureStateOf, captureStatusLabel, longDate, parseAmountInput, type RecoveryKind, type TransactionDetail } from '@wmbugo/core';
import { minorToInput } from '../../shared/minorInput';
import { amountLabel, type AmountKind } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { EmptyState, ErrorBlock, Reveal, Skeleton } from '../../shared/feedback/Feedback';
import { useToast } from '../../shared/feedback/ToastHost';
import { invalidateForEvent } from '../../shared/queryClient';
import { Icon } from '../../shared/theme/Icon';
import type { ColorName } from '../../shared/theme/colors';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { categoryIcon } from '../add/categoryIcons';
import { ScreenHeader } from '../shell/ScreenHeader';
import { duplicatePresetOf, editSpecOf, realTransactionApi, transactionKey, type TransactionApi } from './transactionApi';
import type { AddPreset, EditSpec } from '../add/AddSheet';
import { realAddApi, type AddApi } from '../add/addApi';
import { HeldRowActions } from './HeldRowActions';
import { ReceiptPhotos } from './ReceiptPhotos';

const TYPE_LABEL: Readonly<Record<TransactionDetail['type'], string>> = {
  expense: copy.detail.typeExpense,
  income: copy.detail.typeIncome,
  transfer: copy.detail.typeTransfer,
  refund: copy.detail.typeRefund,
  adjustment: copy.detail.typeAdjustment,
  opening_balance: copy.detail.typeOpening,
  reversal: copy.detail.typeRefund,
};
const AMOUNT_KIND: Readonly<Partial<Record<TransactionDetail['type'], AmountKind>>> = { expense: 'spent', income: 'income', transfer: 'transfer', refund: 'refund' };
const PAYMENT_LABEL: Readonly<Record<string, string>> = { upi: copy.add.payUpi, card: copy.add.payCard, cash: copy.add.payCash, bank_transfer: copy.add.payBank, other: copy.add.payOther };

/** "Added by you · 7 Nov, 9:12 pm", "Bank SMS · 7 Nov, 9:12 pm", "Receipt", "CSV import". */
function sourceLine(kind: string, when: string): string {
  const name =
    kind === 'manual' ? copy.detail.addedByYou : kind === 'sms' ? copy.review.bankSms : kind === 'upi' ? copy.photo.sourceUpi : kind === 'receipt' ? copy.review.receipt : kind === 'csv' ? copy.review.csvImport : kind === 'notification' ? copy.photo.sourceNotification : copy.photo.sourceShare;
  return `${name} · ${when}`;
}

/** "7 Nov, 9:12 pm" in the entry's own time zone. */
function whenText(ms: number, tz: string): string {
  try {
    const day = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short' }).format(ms);
    const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(ms).toLowerCase();
    return `${day}, ${time}`;
  } catch {
    return '';
  }
}

/**
 * One entry in full (SCR-08): what it is, where it sits and where it came from, with Edit, Duplicate and Delete (or
 * Reject · Not mine for a captured entry). Delete and Reject are undoable; nothing disappears without a way back.
 */
export function TransactionDetailScreen({
  transactionId,
  onBack,
  onEdit,
  onDuplicate,
  onSplit,
  api = realTransactionApi,
  duplicateApi = realAddApi,
}: {
  transactionId: string;
  onBack: () => void;
  onEdit: (spec: EditSpec) => void;
  onDuplicate: (preset: AddPreset) => void;
  /** Opens the split editor. */
  onSplit?: (transactionId: string) => void;
  api?: TransactionApi;
  duplicateApi?: Pick<AddApi, 'duplicateInfo' | 'keepBoth' | 'merge' | 'undoResolution'>;
}) {
  const theme = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: transactionKey(transactionId), queryFn: () => api.load(transactionId) });
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const [refundKind, setRefundKind] = useState<RecoveryKind | null>(null);
  const [refundText, setRefundText] = useState('');
  const [leftError, setLeftError] = useState<number | null>(null);
  const ink = { color: theme.color('text-primary') };
  const muted = { color: theme.color('text-secondary') };
  const header = <ScreenHeader title={copy.detail.title} onBack={onBack} backTestID="detail-back" />;

  if (q.data === 'missing') {
    return (
      <View style={styles.fill}>
        {header}
        <EmptyState sentence={copy.detail.notFound} actionLabel={copy.accountDetail.back} onAction={onBack} />
      </View>
    );
  }
  const data = q.data ?? null;
  const d = data?.detail ?? null;

  const refresh = () => invalidateForEvent(qc, 'TransactionsChanged');

  const edit = async () => {
    if (!d) return;
    // Another action may have removed it while this page was open: look again before opening the editor.
    const fresh = await q.refetch();
    const now = fresh.data && fresh.data !== 'missing' ? fresh.data.detail : null;
    if (!now || now.removed) return setError(copy.detail.removedError);
    const spec = editSpecOf(now);
    if (spec) onEdit(spec);
  };

  const duplicate = () => {
    const preset = d ? duplicatePresetOf(d) : null;
    if (preset) onDuplicate(preset);
  };

  const remove = async (kind: 'delete' | 'reject') => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await api.remove(transactionId, kind).catch(() => ({ ok: false as const, code: 'FAILED' }));
      if (!r.ok) {
        setError(r.code === 'ENTRY_REMOVED' ? copy.detail.removedError : copy.duplicate.failed);
        return;
      }
      const snapshot = r.value.snapshot;
      await refresh();
      toast.show({
        message: kind === 'delete' ? copy.detail.deleted : copy.detail.rejected,
        undo: {
          label: copy.common.undo,
          onUndo: () =>
            void api
              .restore(snapshot)
              .then(async (u) => {
                await refresh();
                if (!u.ok) toast.show({ message: copy.add.removeFailed });
              })
              .catch(() => toast.show({ message: copy.add.removeFailed })),
        },
      });
      onBack();
    } finally {
      busy.current = false;
    }
  };

  const openRefund = (kind: RecoveryKind) => {
    if (!data) return;
    setError(null);
    setLeftError(null);
    setRefundKind(kind);
    setRefundText(minorToInput(data.refundableMinor ?? 0, data.exponent));
  };

  const saveRefund = async () => {
    if (!data || !d || !refundKind || busy.current) return;
    const p = parseAmountInput(refundText, data.exponent);
    if (!p.ok || p.value <= 0) return setError(copy.detail.refundFailed);
    const left = data.refundableMinor ?? 0;
    if (p.value > left) return setLeftError(left);
    busy.current = true;
    try {
      const r = await api.refund(transactionId, p.value, refundKind).catch(() => ({ ok: false as const, code: 'FAILED' }));
      if (!r.ok) return (r.code === 'EXCEEDS_REFUNDABLE' ? setLeftError(left) : setError(copy.detail.refundFailed));
      const refundId = r.value.transactionId;
      const kind = refundKind;
      setRefundKind(null);
      setError(null);
      await refresh();
      toast.show({
        message: kind === 'refund' ? copy.detail.refundSaved : copy.detail.paidBackSaved,
        undo: {
          label: copy.common.undo,
          onUndo: () =>
            void api
              .remove(refundId, 'delete')
              .then(async () => {
                await refresh();
              })
              .catch(() => toast.show({ message: copy.add.removeFailed })),
        },
      });
    } finally {
      busy.current = false;
    }
  };

  const addPhoto = async () => {
    if (!api.addPhoto || busy.current) return;
    busy.current = true;
    try {
      const r = await api.addPhoto(transactionId);
      if (r === 'added') {
        await refresh();
        toast.show({ message: copy.photo.added });
      } else if (r === 'duplicate') toast.show({ message: copy.photo.alreadyAttached });
      else if (r === 'failed') setError(copy.photo.failed);
    } finally {
      busy.current = false;
    }
  };

  const removePhoto = async (attachmentId: string) => {
    if (!api.removePhoto) return;
    const r = await api.removePhoto(attachmentId).catch(() => ({ ok: false }));
    if (!r.ok) return setError(copy.photo.removeFailed);
    await refresh();
    toast.show({ message: copy.photo.removed });
  };

  const reverse = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await api.reverse(transactionId).catch(() => ({ ok: false as const, code: 'FAILED' }));
      if (!r.ok) return setError(r.code === 'ALREADY_REVERSED' ? copy.detail.alreadyReversed : copy.detail.reverseFailed);
      const { snapshot, reversalId } = r.value;
      await refresh();
      toast.show({
        message: copy.detail.reversedToast,
        undo: {
          label: copy.common.undo,
          onUndo: () =>
            void api
              .undoReverse(snapshot, reversalId)
              .then(async (u) => {
                await refresh();
                if (!u.ok) toast.show({ message: copy.add.removeFailed });
              })
              .catch(() => toast.show({ message: copy.add.removeFailed })),
        },
      });
    } finally {
      busy.current = false;
    }
  };

  let body = null;
  if (d && data) {
    const captured = d.sourceKind !== 'manual';
    const title = d.merchant ?? d.category?.name ?? (d.type === 'transfer' ? copy.detail.typeTransfer : TYPE_LABEL[d.type]);
    const direction = d.type === 'income' || d.type === 'refund' ? 'income' : d.type === 'expense' ? 'expense' : 'neutral';
    const accountText = d.type === 'transfer' ? `${d.from?.name ?? ''} → ${d.to?.name ?? ''}` : (d.from ?? d.to)?.name ?? null;
    const state = captureStateOf({
      status: d.status as 'draft' | 'needs_review' | 'confirmed' | 'excluded' | 'reversed',
      resolution: d.resolution as 'user_approved' | 'auto_approved' | 'auto_linked' | 'rejected' | null,
      needsCategory: false,
      openDuplicate: d.openDuplicate,
    });
    const spoken = [title, amountLabel({ amountMinor: d.amountMinor, currency: data.currency, locale: data.locale, kind: AMOUNT_KIND[d.type] ?? 'plain', inline: true }), d.category?.name, accountText].filter(Boolean).join(', ');
    const glyph = d.type === 'transfer' ? ArrowsLeftRight : d.category ? categoryIcon(d.category.icon) : DotsThree;
    const rows: [string, string | null][] = [
      [copy.detail.type, TYPE_LABEL[d.type]],
      [copy.detail.date, `${longDate(d.localDate)}, ${whenText(d.occurredAtMs, d.timezoneId).split(', ')[1] ?? ''}`],
      [d.type === 'transfer' ? `${copy.detail.from} → ${copy.detail.to}` : copy.detail.account, accountText],
      [copy.detail.category, data.splits.length > 1 ? `${d.category?.name ?? ''} ${copy.split.more.replace('{n}', String(data.splits.length - 1))}` : (d.category?.name ?? null)],
      [copy.detail.merchant, d.merchant],
      [copy.detail.note, d.note],
      [copy.detail.payment, d.paymentMethod ? (PAYMENT_LABEL[d.paymentMethod] ?? d.paymentMethod) : null],
      [copy.detail.status, copy.capture[captureStatusLabel(state)]],
      ...(data.sources.length > 0 ? [] : [[copy.detail.source, captured ? `${d.sourceKind} · ${whenText(d.addedAtMs, d.timezoneId)}` : `${copy.detail.addedByYou} · ${whenText(d.addedAtMs, d.timezoneId)}`] as [string, string | null]]),
    ];
    body = (
      <ScrollView contentContainerStyle={styles.pad}>
        <View testID="detail-header" accessible accessibilityLabel={spoken} style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
          <View style={[styles.chip, { backgroundColor: theme.color('bg-muted') }]}>
            <Icon icon={glyph} size={24} color={(d.category?.color as ColorName | undefined) ?? 'text-secondary'} />
          </View>
          <View style={styles.flex}>
            <Text style={[textStyle('title'), ink]}>{title}</Text>
            <Amount amountMinor={d.amountMinor} currency={data.currency} direction={direction} role="headline" locale={data.locale} color={direction === 'income' ? 'semantic-income' : 'text-primary'} />
          </View>
        </View>

        {rows
          .filter(([, v]) => v !== null && v !== '')
          .map(([label, value]) => (
            <View key={label} testID={`detail-row-${label}`} accessible accessibilityLabel={`${label}, ${value}`} style={styles.row}>
              <Text style={[textStyle('label'), muted]}>{label}</Text>
              <Text style={[textStyle('body'), ink, styles.value]}>{value}</Text>
            </View>
          ))}

        {data.sources.length > 0 ? (
          <View testID="detail-sources" style={styles.row}>
            <Text style={[textStyle('label'), muted]}>{copy.detail.source}</Text>
            {data.sources.map((src, i) => (
              <Text key={i} style={[textStyle('body'), ink]}>
                {sourceLine(src.kind, whenText(src.atMs, d.timezoneId))}
              </Text>
            ))}
            {data.sources.find((src) => src.kind !== 'manual' && src.reference) ? (
              <Text testID="detail-as-recorded" style={[textStyle('caption'), muted]}>
                {copy.photo.asRecorded.replace('{text}', data.sources.find((src) => src.kind !== 'manual' && src.reference)!.reference!)}
              </Text>
            ) : null}
          </View>
        ) : null}

        {d.status === 'reversed' && data.reversedOn ? (
          <Text testID="detail-reversed" style={[textStyle('body-medium'), ink]}>
            {copy.detail.reversedOn.replace('{date}', longDate(data.reversedOn))}
          </Text>
        ) : null}

        {d.type === 'expense' && (data.recovery.refundedMinor > 0 || data.recovery.reimbursedMinor > 0) ? (
          <View testID="detail-recovery" style={styles.row}>
            <View style={styles.splitLine}><Text style={[textStyle("body"), ink]}>{copy.detail.youPaid}</Text><Amount amountMinor={d.amountMinor} currency={data.currency} direction="neutral" locale={data.locale} /></View>
            {data.recovery.refundedMinor > 0 ? <View style={styles.splitLine}><Text style={[textStyle("body"), ink]}>{copy.detail.refundedLine}</Text><Amount amountMinor={data.recovery.refundedMinor} currency={data.currency} direction="neutral" locale={data.locale} /></View> : null}
            {data.recovery.reimbursedMinor > 0 ? <View style={styles.splitLine}><Text style={[textStyle("body"), ink]}>{copy.detail.paidBack}</Text><Amount amountMinor={data.recovery.reimbursedMinor} currency={data.currency} direction="neutral" locale={data.locale} /></View> : null}
            {data.recovery.reimbursedMinor > 0 ? <View style={styles.splitLine}><Text style={[textStyle("body"), ink]}>{copy.detail.yourShare}</Text><Amount amountMinor={Math.max(0, d.amountMinor - data.recovery.refundedMinor - data.recovery.reimbursedMinor)} currency={data.currency} direction="neutral" locale={data.locale} /></View> : null}
          </View>
        ) : null}

        {refundKind ? (
          <View testID="refund-form" style={styles.row}>
            <Text style={[textStyle('label'), muted]}>{refundKind === 'refund' ? copy.detail.refundAmount : copy.detail.paidBackAmount}</Text>
            <TextInput
              testID="refund-amount"
              value={refundText}
              onChangeText={setRefundText}
              keyboardType="decimal-pad"
              accessibilityLabel={refundKind === 'refund' ? copy.detail.refundAmount : copy.detail.paidBackAmount}
              style={[textStyle('body'), ink, styles.input, { borderColor: theme.color('border-hairline') }]}
            />
            <View style={styles.actions}>
              <Button label={copy.common.save} onPress={() => void saveRefund()} testID="refund-save" />
              <Button label={copy.common.cancel} variant="text" onPress={() => { setRefundKind(null); setError(null); }} testID="refund-cancel" />
            </View>
          </View>
        ) : null}

        {data.splits.length > 1 ? (
          <View testID="detail-splits" style={styles.row}>
            {data.splits.map((sp) => (
              <View key={sp.id} accessible accessibilityLabel={`${sp.notItemised ? copy.split.notItemised : sp.categoryName}, ${amountLabel({ amountMinor: sp.amountMinor, currency: data.currency, locale: data.locale })}`} style={styles.splitLine}>
                <Text style={[textStyle('body'), sp.notItemised ? muted : ink]}>{sp.notItemised ? copy.split.notItemised : sp.categoryName}</Text>
                <Amount amountMinor={sp.amountMinor} currency={data.currency} direction="neutral" locale={data.locale} />
              </View>
            ))}
          </View>
        ) : null}

        {d.openDuplicate ? (
          <View testID="detail-check" style={styles.row}>
            <Text style={[textStyle('body-medium'), ink]}>{copy.capture.possibleDuplicate}</Text>
            <HeldRowActions transactionId={d.id} api={duplicateApi} />
          </View>
        ) : null}

        {leftError !== null ? (
          <View testID="detail-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.splitLine}>
            <Text style={[textStyle('body-medium'), ink]}>{copy.detail.exceedsA}</Text>
            <Amount amountMinor={leftError} currency={data.currency} direction="neutral" locale={data.locale} />
            <Text style={[textStyle('body-medium'), ink]}>{copy.detail.exceedsB.toLowerCase()}</Text>
          </View>
        ) : null}

        {error ? (
          <Text testID="detail-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('body-medium'), ink]}>
            {error}
          </Text>
        ) : null}

        {d.removed ? null : (
          <ReceiptPhotos photos={data.attachments} photoPath={api.photoPath} onAdd={api.addPhoto ? () => void addPhoto() : undefined} onRemove={api.removePhoto ? removePhoto : undefined} />
        )}

        {d.removed ? null : (
          <View style={styles.actions}>
            {editSpecOf(d) ? <Button label={copy.detail.edit} variant="secondary" onPress={() => void edit()} testID="detail-edit" /> : null}
            {editSpecOf(d) ? <Button label={copy.detail.duplicate} variant="secondary" onPress={duplicate} testID="detail-duplicate" /> : null}
            {(d.type === 'expense' || d.type === 'income') && onSplit ? <Button label={copy.split.action} variant="secondary" onPress={() => onSplit(d.id)} testID="detail-split" /> : null}
            {d.type === 'expense' && d.status === 'confirmed' && (data.refundableMinor ?? 0) > 0 && !refundKind ? <Button label={copy.detail.recordRefund} variant="secondary" onPress={() => openRefund('refund')} testID="detail-refund" /> : null}
            {d.type === 'expense' && d.status === 'confirmed' && (data.refundableMinor ?? 0) > 0 && !refundKind ? <Button label={copy.detail.gotPaidBack} variant="secondary" onPress={() => openRefund('reimbursement')} testID="detail-paidback" /> : null}
            {d.type === 'expense' && d.status === 'confirmed' ? <Button label={copy.detail.reverse} variant="secondary" onPress={() => void reverse()} testID="detail-reverse" /> : null}
            {['expense', 'income', 'transfer', 'refund'].includes(d.type) ? (
              <Button label={captured ? copy.detail.reject : copy.detail.delete} variant="text" onPress={() => void remove(captured ? 'reject' : 'delete')} testID={captured ? 'detail-reject' : 'detail-delete'} />
            ) : null}
            {d.type === 'expense' && d.status === 'confirmed' ? <Text testID="detail-reverse-hint" style={[textStyle('label'), muted, styles.hint]}>{copy.detail.reverseHint}</Text> : null}
          </View>
        )}
      </ScrollView>
    );
  }

  return (
    <View style={styles.fill}>
      {header}
      <Reveal
        loading={q.isLoading}
        skeleton={
          <View style={styles.pad} testID="detail-skeleton">
            <Skeleton height={96} />
            <Skeleton height={48} />
          </View>
        }
        fill>
        {body ?? (q.isError || q.data === null ? <View style={styles.pad}><ErrorBlock cause={copy.detail.loadError} onRetry={() => void q.refetch()} /></View> : null)}
      </Reveal>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  pad: { padding: 16, gap: 12 },
  card: { borderWidth: 1, borderRadius: radii.md, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  chip: { width: 48, height: 48, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center' },
  row: { gap: 2, minHeight: 48, justifyContent: 'center' },
  value: { flexShrink: 1 },
  splitLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 40 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hint: { width: '100%' },
  input: { borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 12, minHeight: 48 },
});
