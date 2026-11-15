import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { dayMonthLabel, type BillHistoryItem } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { EmptyState, ErrorBlock, Skeleton } from '../../shared/feedback/Feedback';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { TopBar } from '../../shared/ui/TopBar';
import { BillRow } from './BillRow';
import { billDetailKey, realBillsApi, type BillsApi } from './billsApi';
import { cadenceText, KIND_LABEL } from './billText';
import { useBillActions } from './useBillActions';

const b = copy.bills;

const historyText = (h: BillHistoryItem): string => {
  const date = dayMonthLabel(h.dueDate);
  if (h.status === 'paid') return (h.paidBy === 'linked' ? b.historyPaidLinked : b.historyPaidMarked).replace('{date}', date);
  return b.historyNotMarked.replace('{date}', date);
};

/**
 * A bill's detail (Story 6.2): its fields, next due date, the history of its due dates and the actions Edit, Mark as paid,
 * Pause or Resume, End this bill and (only without payment history) Delete.
 */
export function BillDetailScreen({ ruleId, onBack, api = realBillsApi }: { ruleId: string; onBack: () => void; api?: BillsApi }) {
  const theme = useTheme();
  const actions = useBillActions(api);
  const q = useQuery({ queryKey: billDetailKey(ruleId), queryFn: () => api.loadDetail(ruleId) });
  const header = <TopBar title={b.detailTitle} onBack={onBack} backTestID="bill-detail-back" />;

  if (q.isError) return <View style={styles.fill}>{header}<ErrorBlock cause={b.loadError} onRetry={() => void q.refetch()} /></View>;
  if (q.data === 'missing') return <View style={styles.fill}>{header}<EmptyState sentence={b.deletedElsewhere} actionLabel={b.backToBills} onAction={onBack} /></View>;
  if (!q.data) {
    return (
      <View style={styles.fill} testID="bill-detail-loading">
        {header}
        <View style={styles.pad}>
          <Skeleton height={64} />
          <Skeleton height={16} width="60%" />
        </View>
      </View>
    );
  }

  const data = q.data;
  const d = data.detail;
  const pickers = { exponent: data.exponent, categories: data.categories, accounts: data.accounts };
  const ink = { color: theme.color('text-primary') };
  const muted = { color: theme.color('text-secondary') };
  const row = d.row;
  const active = row.state === 'active';
  const rule = { id: d.rule.id, title: d.rule.title };

  return (
    <View style={styles.fill} testID="bill-detail">
      {header}
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <BillRow row={row} currency={data.currency} locale={data.locale} onPress={() => undefined} />
        <View style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
          <Text testID="bill-detail-repeats" style={[textStyle('body'), ink]}>{`${cadenceText(row)} · ${KIND_LABEL[row.kind]}`}</Text>
          {row.accountName ? <Text style={[textStyle('body'), ink]}>{row.accountName}</Text> : null}
          {row.categoryName ? <Text style={[textStyle('body'), ink]}>{row.categoryName}</Text> : null}
          {d.rule.paidTo ? <Text style={[textStyle('body'), ink]}>{d.rule.paidTo}</Text> : null}
          <Amount amountMinor={row.expectedAmountMinor} currency={data.currency} locale={data.locale} direction="neutral" role="body" />
          {row.nextDue && active ? <Text testID="bill-detail-next" style={[textStyle('body-medium'), ink]}>{b.detailNext.replace('{date}', dayMonthLabel(row.nextDue))}</Text> : null}
        </View>

        <Text accessibilityRole="header" style={[textStyle('label'), muted]}>{b.history}</Text>
        {d.history.length === 0 ? (
          <Text testID="bill-history-empty" style={[textStyle('body'), muted]}>{b.historyNone}</Text>
        ) : (
          <View testID="bill-history" style={styles.gap}>
            {d.history.map((h) => (
              <Text key={h.dueDate} testID={`bill-history-${h.dueDate}`} style={[textStyle('body'), h.status === 'paid' ? ink : muted]}>{historyText(h)}</Text>
            ))}
          </View>
        )}

        <View style={styles.actions}>
          {d.markableDate ? <Button label={b.markAsPaid} testID="bill-detail-mark" onPress={() => actions.confirmMarkPaid(rule, d.markableDate!)} /> : null}
          {row.state !== 'ended' ? <Button label={b.edit} variant="secondary" testID="bill-detail-edit" onPress={() => actions.openEditor({ mode: 'edit', rule: d.rule }, pickers)} /> : null}
          {active ? <Button label={b.pause} variant="secondary" testID="bill-detail-pause" onPress={() => void actions.pause(rule)} /> : null}
          {row.state === 'paused' ? <Button label={b.resume} variant="secondary" testID="bill-detail-resume" onPress={() => void actions.resume(rule)} /> : null}
          {row.state !== 'ended' ? <Button label={b.end} variant="text" testID="bill-detail-end" onPress={() => actions.confirmEnd(rule)} /> : null}
          {d.canDelete ? (
            <Button label={b.delete} variant="text" testID="bill-detail-delete" onPress={() => actions.confirmDelete(rule, onBack)} />
          ) : (
            <Text testID="bill-detail-has-history" style={[textStyle('caption'), muted]}>{b.hasHistory.replace('{name}', d.rule.title)}</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: 16, gap: 12, paddingBottom: 120 },
  gap: { gap: 8 },
  card: { borderWidth: 1, borderRadius: radii.md, padding: 12, gap: 6 },
  actions: { gap: 8, marginTop: 8 },
});
