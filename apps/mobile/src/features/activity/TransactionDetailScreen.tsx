import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowsLeftRight, DotsThree } from 'phosphor-react-native';
import { captureStateOf, captureStatusLabel, longDate, type TransactionDetail } from '@wmbugo/core';
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
  api = realTransactionApi,
  duplicateApi = realAddApi,
}: {
  transactionId: string;
  onBack: () => void;
  onEdit: (spec: EditSpec) => void;
  onDuplicate: (preset: AddPreset) => void;
  api?: TransactionApi;
  duplicateApi?: Pick<AddApi, 'duplicateInfo' | 'keepBoth' | 'merge' | 'undoResolution'>;
}) {
  const theme = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: transactionKey(transactionId), queryFn: () => api.load(transactionId) });
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
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
      [copy.detail.category, d.category?.name ?? null],
      [copy.detail.merchant, d.merchant],
      [copy.detail.note, d.note],
      [copy.detail.payment, d.paymentMethod ? (PAYMENT_LABEL[d.paymentMethod] ?? d.paymentMethod) : null],
      [copy.detail.status, copy.capture[captureStatusLabel(state)]],
      [copy.detail.source, captured ? `${d.sourceKind} · ${whenText(d.addedAtMs, d.timezoneId)}` : `${copy.detail.addedByYou} · ${whenText(d.addedAtMs, d.timezoneId)}`],
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

        {d.openDuplicate ? (
          <View testID="detail-check" style={styles.row}>
            <Text style={[textStyle('body-medium'), ink]}>{copy.capture.possibleDuplicate}</Text>
            <HeldRowActions transactionId={d.id} api={duplicateApi} />
          </View>
        ) : null}

        {error ? (
          <Text testID="detail-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle('body-medium'), ink]}>
            {error}
          </Text>
        ) : null}

        {d.removed ? null : (
          <View style={styles.actions}>
            {editSpecOf(d) ? <Button label={copy.detail.edit} variant="secondary" onPress={() => void edit()} testID="detail-edit" /> : null}
            {editSpecOf(d) ? <Button label={copy.detail.duplicate} variant="secondary" onPress={duplicate} testID="detail-duplicate" /> : null}
            {['expense', 'income', 'transfer', 'refund'].includes(d.type) ? (
              <Button label={captured ? copy.detail.reject : copy.detail.delete} variant="text" onPress={() => void remove(captured ? 'reject' : 'delete')} testID={captured ? 'detail-reject' : 'detail-delete'} />
            ) : null}
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
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
