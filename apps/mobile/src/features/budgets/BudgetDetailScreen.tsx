import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CaretLeft, CaretRight } from 'phosphor-react-native';
import { dayMonthLabel, monthName, type ActivityQuery, type ActivityRow, type BudgetDetail, type BudgetEntry } from '@wmbugo/core';
import { controlA11y } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { EmptyState, ErrorBlock, Skeleton } from '../../shared/feedback/Feedback';
import { useSheet } from '../../shared/feedback/SheetHost';
import { useToast } from '../../shared/feedback/ToastHost';
import { invalidateForEvent } from '../../shared/queryClient';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { layout, radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { Button } from '../../shared/ui/Button';
import { LimitBar } from '../../shared/ui/LimitBar';
import { ActivityRowView } from '../activity/ActivityRowView';
import { ScreenHeader } from '../shell/ScreenHeader';
import { BudgetSheet } from './BudgetSheet';
import { BUDGETS_QUERY_KEY, realBudgetsApi, type BudgetDetailData, type BudgetsApi } from './budgetsApi';

export const budgetDetailKey = (id: string, back: number | string) => ['budgets', 'detail', id, back] as const;

/** A budget entry as an Activity row: an expense reads as spending, a refund as money back. */
export const entryAsRow = (e: BudgetEntry, accountName: string | null = e.accountName): ActivityRow => ({
  id: e.id,
  kind: e.kind,
  amountMinor: e.amountMinor,
  localDate: e.localDate,
  merchant: e.merchant,
  categoryName: e.categoryName,
  categoryIcon: e.categoryIcon,
  categoryColor: e.categoryColor,
  accountName,
});

/** `Left ₹11,860 ...` with the amount rendered by <Amount>: a template with {amount} is split around it. */
function TemplateAmount({ template, amountMinor, data, direction = 'neutral', testID, tail }: { template: string; amountMinor: number; data: BudgetDetailData; direction?: 'neutral' | 'income'; testID?: string; tail?: Record<string, string> }) {
  const theme = useTheme();
  const fill = (s: string) => Object.entries(tail ?? {}).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), s);
  const [before = '', after = ''] = template.split('{amount}');
  const style = [textStyle('body'), { color: theme.color('text-primary') }];
  return (
    <Text testID={testID} style={style}>
      {fill(before)}
      <Amount amountMinor={amountMinor} currency={data.currency} locale={data.locale} direction={direction} role="body" />
      {fill(after)}
    </Text>
  );
}

/**
 * SCR-15 Budget: the limit bar and status for one period, what is left, a projection, refunds, the entries that make it
 * up and a switcher to earlier periods (never a future one). Edit changes the limit from this period or the next; Delete
 * is soft and can be undone. Every figure comes from the entries' dates and the target version that period had.
 */
export function BudgetDetailScreen({ budgetId, periodStart, onBack, onOpenEntry, onOpenActivity, api = realBudgetsApi }: { budgetId: string; /** A tapped notification opens the period it was about. */ periodStart?: string; onBack: () => void; onOpenEntry: (transactionId: string) => void; /** Opens Activity filtered to a category and this period (a drill-down row). */ onOpenActivity?: (query: ActivityQuery) => void; api?: BudgetsApi }) {
  const theme = useTheme();
  const qc = useQueryClient();
  const sheet = useSheet();
  const toast = useToast();
  const [back, setBack] = useState<number | string>(periodStart ?? 0);
  const q = useQuery({ queryKey: budgetDetailKey(budgetId, back), queryFn: () => api.loadDetail(budgetId, back) });
  const header = <ScreenHeader title={copy.budgets.detailTitle} onBack={onBack} backTestID="budget-detail-back" />;

  if (q.isError) return <View style={styles.fill}>{header}<ErrorBlock cause={copy.budgets.loadError} onRetry={() => void q.refetch()} /></View>;
  if (q.data === 'missing') {
    return (
      <View style={styles.fill}>
        {header}
        <EmptyState sentence={copy.budgets.deletedElsewhere} actionLabel={copy.budgets.backToBudgets} onAction={onBack} />
      </View>
    );
  }
  if (!q.data) {
    return (
      <View style={styles.fill} testID="budget-detail-loading">
        {header}
        <View style={styles.pad}>
          <Skeleton height={20} />
          <Skeleton height={8} />
          <Skeleton height={16} width="60%" />
        </View>
      </View>
    );
  }

  const data = q.data;
  const d = data.detail;
  const ink = { color: theme.color('text-primary') };
  const muted = { color: theme.color('text-secondary') };
  const refresh = async () => {
    await invalidateForEvent(qc, 'BudgetsChanged');
  };

  const edit = async () => {
    const budget = await api.readForEdit(budgetId).catch(() => null);
    const list = await api.load().catch(() => null);
    if (!budget || !list) return;
    sheet.open({
      id: 'budget',
      title: copy.budgets.editTitle,
      body: (close) => (
        <BudgetSheet
          start={{ mode: 'edit', budget }}
          data={list}
          close={close}
          onEditExisting={() => undefined}
          onSave={async (input) => {
            const r = await api.save(input);
            if (r.ok) {
              await refresh();
              const saved = r.value;
              toast.show({
                message: copy.budgets.saved,
                undo: {
                  label: copy.common.undo,
                  onUndo: () =>
                    void api
                      .undo({ budgetId: saved.budgetId, created: saved.created, snapshot: saved.snapshot! })
                      .then(refresh)
                      .catch(() => toast.show({ message: copy.budgets.undoFailed })),
                },
              });
            }
            return r;
          }}
        />
      ),
    });
  };

  const remove = () => {
    sheet.open({
      id: 'budget-delete',
      title: copy.budgets.delete,
      body: (close) => (
        <View testID="budget-delete-sheet" style={styles.gap}>
          <Text style={[textStyle('body'), { color: theme.color('on-glass-primary') }]}>{copy.budgets.deleteConfirm.replace('{name}', d.name)}</Text>
          <Button
            label={copy.budgets.deleteAction}
            testID="budget-delete-confirm"
            onPress={() => {
              close();
              void (async () => {
                const r = await api.remove(budgetId).catch(() => ({ ok: false }));
                if (!r.ok) return toast.show({ message: copy.budgets.deleteFailed });
                await refresh();
                toast.show({
                  message: copy.budgets.deleted,
                  undo: { label: copy.common.undo, onUndo: () => void api.restore(budgetId).then(refresh).catch(() => toast.show({ message: copy.budgets.undoFailed })) },
                });
                onBack();
              })();
            }}
          />
          <Button label={copy.budgets.cancel} variant="text" onGlass testID="budget-delete-cancel" onPress={close} />
        </View>
      ),
    });
  };

  const daysLeft = d.status.daysRemaining > 0 ? (d.status.daysRemaining === 1 ? copy.budgets.dayLeft : copy.budgets.daysLeft.replace('{n}', String(d.status.daysRemaining))) : null;
  const over = d.status.remainingMinor < 0;
  const prevMonth = d.previousStart ? monthName(d.previousStart) : '';
  const nextMonth = d.nextStart ? monthName(d.nextStart) : '';

  return (
    <View style={styles.fill} testID="budget-detail">
      {header}
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={[textStyle('title'), ink]}>{d.name}</Text>

        <View style={styles.switcher}>
          <Pressable
            testID="budget-period-back"
            {...controlA11y({ label: copy.budgets.previousPeriod.replace('{month}', prevMonth), role: 'button', disabled: !d.canGoBack })}
            disabled={!d.canGoBack}
            onPress={() => setBack(d.back + 1)}
            style={[styles.switchBtn, { opacity: d.canGoBack ? 1 : 0.4 }]}>
            <Icon icon={CaretLeft} size={18} color="text-secondary" />
            <Text style={[textStyle('label'), muted]}>{prevMonth}</Text>
          </Pressable>
          <Text testID="budget-period-label" style={[textStyle('body-medium'), ink, styles.centerText]}>
            {daysLeft ? copy.budgets.periodDaysLeft.replace('{label}', d.periodLabel).replace('{days}', daysLeft) : d.periodLabel}
          </Text>
          <Pressable
            testID="budget-period-forward"
            {...controlA11y({ label: copy.budgets.nextPeriod.replace('{month}', nextMonth), role: 'button', disabled: !d.canGoForward })}
            disabled={!d.canGoForward}
            onPress={() => setBack(Math.max(0, d.back - 1))}
            style={[styles.switchBtn, { opacity: d.canGoForward ? 1 : 0.4 }]}>
            <Text style={[textStyle('label'), muted]}>{nextMonth}</Text>
            <Icon icon={CaretRight} size={18} color="text-secondary" />
          </Pressable>
        </View>

        <View style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
          <LimitBar
            testID="detail-limit"
            name={d.name}
            status={d.status}
            currency={data.currency}
            locale={data.locale}
            {...(d.scope === 'savings' ? { tone: 'savings' as const, savings: true, movedOut: (d.savingsMovedMinor ?? 0) < 0 } : d.scope === 'budget_type' && d.budgetType ? { tone: d.budgetType === 'need' ? ('needs' as const) : ('wants' as const) } : {})}
          />
        </View>

        {d.scope === 'savings' ? null : <TemplateAmount testID="budget-left" template={over ? copy.budgets.overLine : copy.budgets.leftLine} amountMinor={over ? d.usedMinor - d.targetMinor : d.status.remainingMinor} data={data} />}
        {d.scope !== 'savings' && d.status.projectedMinor !== null ? (
          <TemplateAmount testID="budget-projected" template={copy.budgets.projected} amountMinor={d.status.projectedMinor} data={data} tail={{ date: dayMonthLabel(d.period.end) }} />
        ) : null}
        {d.refundSurplusMinor > 0 ? <TemplateAmount testID="budget-refunds" template={copy.budgets.refundsThisPeriod} amountMinor={d.refundSurplusMinor} data={data} direction="income" /> : null}

        {d.breakdown && d.breakdown.length > 0 ? (
          <View testID="budget-breakdown" style={styles.gap}>
            <Text accessibilityRole="header" style={[textStyle('label'), muted]}>{copy.budgets.byCategory}</Text>
            {d.breakdown.map((c) => (
              <Pressable
                key={c.categoryId}
                testID={`budget-share-${c.categoryId}`}
                accessible
                accessibilityRole={onOpenActivity ? 'button' : 'text'}
                onPress={onOpenActivity ? () => onOpenActivity({ categoryIds: c.memberIds, fromDate: d.period.start, toDate: d.period.end }) : undefined}
                style={styles.share}>
                <Text style={[textStyle('body'), ink, styles.shareName]}>{c.name}</Text>
                <Amount amountMinor={c.amountMinor} currency={data.currency} locale={data.locale} direction="neutral" role="body" />
              </Pressable>
            ))}
          </View>
        ) : null}

        <Text accessibilityRole="header" style={[textStyle('label'), muted]}>{d.scope === 'savings' ? copy.budgets.transfersHeading : copy.budgets.entriesHeading}</Text>
        {d.entries.length === 0 ? (
          <Text testID="budget-nothing" style={[textStyle('body'), muted]}>{copy.budgets.nothingCounted}</Text>
        ) : (
          <View testID="budget-entries" style={styles.gap}>
            {d.entries.map((e) => (
              <ActivityRowView key={e.id} row={entryAsRow(e)} date={d.today} currency={data.currency} locale={data.locale} showDate onPress={() => onOpenEntry(e.id)} />
            ))}
          </View>
        )}

        {d.scope === 'overall' || d.scope === 'category' ? (
          <View style={styles.actions}>
            <Button label={copy.budgets.edit} variant="secondary" testID="budget-edit" onPress={() => void edit()} />
            <Button label={copy.budgets.delete} variant="text" testID="budget-delete" onPress={remove} />
          </View>
        ) : (
          <Text testID="budget-template-managed" style={[textStyle('caption'), muted]}>{copy.budgets.templateManaged}</Text>
        )}
      </ScrollView>
    </View>
  );
}

// The list query is refreshed by the same BudgetsChanged event; keep the key exported for the Plan tab.
export { BUDGETS_QUERY_KEY };
export type { BudgetDetail };

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: 16, gap: 12, paddingBottom: 120 },
  gap: { gap: 8 },
  switcher: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  switchBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: layout.touchMin, minWidth: layout.touchMin, justifyContent: 'center' },
  centerText: { flex: 1, textAlign: 'center' },
  card: { borderWidth: 1, borderRadius: radii.md, padding: 12 },
  share: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  shareName: { flexShrink: 1 },
  actions: { gap: 8, marginTop: 8 },
});
