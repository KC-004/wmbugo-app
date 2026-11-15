import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { dayMonthLabel, type BillHistoryItem, type CurrencyCode } from '@wmbugo/core';
import { useAmountsHidden } from '../../shared/state/amountsHidden';
import { moneyText } from '../../shared/ui/moneyText';
import { copy } from '../../shared/copy';
import { EmptyState, ErrorBlock, Skeleton } from '../../shared/feedback/Feedback';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { TopBar } from '../../shared/ui/TopBar';
import { ActivityRowView } from '../activity/ActivityRowView';
import { BillRow } from './BillRow';
import { billDetailKey, realBillsApi, type BillsApi } from './billsApi';
import { cadenceText, KIND_LABEL } from './billText';
import { useBillActions } from './useBillActions';

const b = copy.bills;

/** A linked payment shows what was actually paid and when (`Paid ₹18,500 · 4 Dec`); a marked one shows the due date. */
const historyText = (h: BillHistoryItem, currency: CurrencyCode, locale: string): string => {
  const date = dayMonthLabel(h.dueDate);
  if (h.status === 'paid' && h.paidBy === 'linked' && h.paidAmountMinor !== null) return b.historyPaidAmount.replace('{amount}', moneyText(h.paidAmountMinor, currency, locale)).replace('{date}', dayMonthLabel(h.paidOn ?? h.dueDate));
  if (h.status === 'paid') return (h.paidBy === 'linked' ? b.historyPaidLinked : b.historyPaidMarked).replace('{date}', date);
  return b.historyNotMarked.replace('{date}', date);
};

/**
 * A bill's detail (Story 6.2): its fields, next due date, the history of its due dates and the actions Edit, Mark as paid,
 * Pause or Resume, End this bill and (only without payment history) Delete.
 */
export function BillDetailScreen({ ruleId, onBack, onOpenEntry, api = realBillsApi }: { ruleId: string; onBack: () => void; /** Opens a linked entry (a subscription's past charge). */ onOpenEntry?: (transactionId: string) => void; api?: BillsApi }) {
  useAmountsHidden(); // re-render when Hide amounts is toggled: the history builds amount text
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
              <Text key={h.dueDate} testID={`bill-history-${h.dueDate}`} style={[textStyle('body'), h.status === 'paid' ? ink : muted]}>{historyText(h, data.currency, data.locale)}</Text>
            ))}
          </View>
        )}

        {row.kind === 'subscription' ? (
          <View testID="bill-past-charges" style={styles.gap}>
            <Text accessibilityRole="header" style={[textStyle('label'), muted]}>{b.pastCharges}</Text>
            <Text style={[textStyle('caption'), muted]}>{b.pastChargesCaption}</Text>
            {d.history.filter((h) => h.status === 'paid').length === 0 ? (
              <Text testID="bill-past-none" style={[textStyle('body'), muted]}>{b.pastNone}</Text>
            ) : (
              d.history
                .filter((h) => h.status === 'paid')
                .map((h) =>
                  h.paidBy === 'linked' && h.transactionId && h.entry ? (
                    <ActivityRowView
                      key={h.dueDate}
                      row={{ id: h.transactionId, kind: 'expense', amountMinor: h.paidAmountMinor ?? 0, localDate: h.paidOn ?? h.dueDate, merchant: h.entry.merchant, categoryName: h.entry.categoryName, categoryIcon: h.entry.categoryIcon, categoryColor: h.entry.categoryColor, accountName: h.entry.accountName }}
                      date={d.today}
                      currency={data.currency}
                      locale={data.locale}
                      showDate
                      {...(onOpenEntry ? { onPress: () => onOpenEntry(h.transactionId!) } : {})}
                    />
                  ) : (
                    <Text key={h.dueDate} testID={`bill-past-marked-${h.dueDate}`} style={[textStyle('body'), ink]}>{b.markedAsPaidOn.replace('{date}', dayMonthLabel(h.dueDate))}</Text>
                  ),
                )
            )}
          </View>
        ) : null}

        <View style={styles.actions}>
          {d.markableDate ? <Button label={b.markAsPaid} testID="bill-detail-mark" onPress={() => actions.confirmMarkPaid(rule, d.markableDate!)} /> : null}
          {d.markableDate ? <Button label={b.linkAnEntry} variant="secondary" testID="bill-detail-link" onPress={() => actions.openLinkPicker(rule, d.markableDate!, { currency: data.currency, locale: data.locale, today: d.today })} /> : null}
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
