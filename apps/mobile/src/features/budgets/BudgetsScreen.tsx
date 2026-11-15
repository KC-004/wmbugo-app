import { useAmountsHidden } from '../../shared/state/amountsHidden';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useUiStore } from '../../shared/state/uiStore';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActivityQuery, BudgetGroup, BudgetListRow } from '@wmbugo/core';
import { controlA11y } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { useSheet } from '../../shared/feedback/SheetHost';
import { useToast } from '../../shared/feedback/ToastHost';
import { invalidateForEvent } from '../../shared/queryClient';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { moneyText } from '../../shared/ui/moneyText';
import { AlertAskSheet } from './AlertAskSheet';
import { BudgetSheet, type BudgetSheetMode } from './BudgetSheet';
import { TemplateSheet } from './TemplateSheet';
import { BUDGETS_QUERY_KEY, realBudgetsApi, type BudgetsApi, type BudgetsData } from './budgetsApi';
import { LimitBar } from '../../shared/ui/LimitBar';

const GROUPS: readonly { group: BudgetGroup; title: string }[] = [
  { group: 'overall', title: copy.budgets.groupOverall },
  { group: '50_30_20', title: copy.budgets.groupTemplate },
  { group: 'categories', title: copy.budgets.groupCategories },
];

/**
 * SCR-14 Budgets, shown on the Plan tab until the Plan hub (Epic 6). Budgets are grouped Overall, 50/30/20 and Categories
 * and never added together. Each row is a limit bar counted from the entries; tap a row to edit it.
 */
export function BudgetsScreen({ api = realBudgetsApi, onUseTemplate, onOpen, onOpenActivity, compact = false, onSeeAll }: { api?: BudgetsApi; /** The Plan hub's Budgets section (Story 6.8): the setup and income cards, the 50/30/20 bars and up to three other bars by percent used. */ compact?: boolean; onSeeAll?: () => void; /** The one-tap 50/30/20 split (Story 4.10) hooks in here. */ onUseTemplate?: () => void; /** Opens SCR-15 for a budget; without it a row opens the editor. */   onOpen?: (budgetId: string) => void;
  /** Opens Activity filtered to a period's entries (`Not classified · Sort it`). */
  onOpenActivity?: (query: ActivityQuery) => void;
}) {
  useAmountsHidden(); // re-render when Hide amounts is toggled: this component builds amount text and labels
  const theme = useTheme();
  const qc = useQueryClient();
  const sheet = useSheet();
  const toast = useToast();
  const q = useQuery({ queryKey: BUDGETS_QUERY_KEY, queryFn: () => api.load() });
  const data = q.data ?? null;

  const open = (start: BudgetSheetMode, d: BudgetsData) => {
    sheet.open({
      id: 'budget',
      title: start.mode === 'add' ? copy.budgets.addTitle : copy.budgets.editTitle,
      body: (close) => (
        <BudgetSheet
          start={start}
          data={d}
          close={close}
          onEditExisting={(id) => void edit(id, d)}
          onSave={async (input) => {
            const r = await api.save(input);
            if (r.ok) {
              await invalidateForEvent(qc, 'BudgetsChanged');
              const saved = r.value;
              // The first budget saved with alerts on offers the notification ask, once. The editor closes itself after this returns,
              // so the ask opens just after.
              if (saved.created && !input.muted && input.alertLevels.length > 0) {
                void api.shouldAskForAlerts?.().then((ask) => {
                  if (ask) setTimeout(() => openAsk(), 0);
                });
              }
              toast.show({
                message: copy.budgets.saved,
                undo: {
                  label: copy.common.undo,
                  onUndo: () =>
                    void api
                      .undo({ budgetId: saved.budgetId, created: saved.created, snapshot: saved.snapshot! })
                      .then(async (u) => (u.ok ? invalidateForEvent(qc, 'BudgetsChanged') : toast.show({ message: copy.budgets.undoFailed })))
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

  const openAsk = () =>
    sheet.open({
      id: 'budget-alert-ask',
      title: copy.budgets.askTitle,
      body: (close) => <AlertAskSheet close={close} onAnswer={(allow) => void api.answerAlertAsk?.(allow).catch(() => undefined)} />,
    });

  /** The 50/30/20 sheet (Story 4.10). `income` pre-fills it: from the setup card the onboarding figure, otherwise the best suggestion. */
  const openTemplate = (d: BudgetsData, income: number | null) => {
    sheet.open({
      id: 'budget-template',
      title: copy.budgets.templateTitle,
      body: (close) => (
        <TemplateSheet
          template={d.template}
          initialIncomeMinor={income ?? d.template.suggestedIncomeMinor}
          payCycle={d.payCycle}
          exponent={d.exponent}
          currency={d.currency}
          locale={d.locale}
          close={close}
          onCreate={async (incomeMinor, targets) => {
            const r = await api.createTemplate(incomeMinor, targets);
            if (!r.ok) return r;
            await invalidateForEvent(qc, 'BudgetsChanged');
            toast.show({
              message: copy.budgets.templateCreated,
              undo: {
                label: copy.common.undo,
                onUndo: () =>
                  void api
                    .undoTemplate(r.budgetIds)
                    .then(async (u) => (u.ok ? invalidateForEvent(qc, 'BudgetsChanged') : toast.show({ message: copy.budgets.undoFailed })))
                    .catch(() => toast.show({ message: copy.budgets.undoFailed })),
              },
            });
            return { ok: true };
          }}
          onEdit={async (targets) => {
            const r = await api.changeTemplate(targets);
            if (r.ok) {
              await invalidateForEvent(qc, 'BudgetsChanged');
              toast.show({ message: copy.budgets.targetsSaved });
            }
            return r;
          }}
        />
      ),
    });
  };

  // Home's `Set a limit` asks for the editor with Overall chosen; open it once the list has loaded, and only once.
  const pendingEditor = useUiStore((s) => s.pendingBudgetEditor);
  useEffect(() => {
    if (!pendingEditor) return;
    // A failed load must not leave the request waiting for a later visit.
    if (q.isError) {
      useUiStore.getState().clearBudgetEditorRequest();
      return;
    }
    if (!data) return;
    useUiStore.getState().clearBudgetEditorRequest();
    // A stale Home can ask for a limit when an overall budget now exists: open that one instead of a second.
    if (data.list.overallId) void edit(data.list.overallId, data);
    else open({ mode: 'add', scope: 'overall' }, data);
  }, [pendingEditor, data, q.isError]);

  const edit = async (id: string, d: BudgetsData) => {
    const budget = await api.readForEdit(id).catch(() => null);
    if (budget) open({ mode: 'edit', budget }, d);
  };

  const answerIncome = async (update: boolean, d: BudgetsData) => {
    const c = d.template.incomeChange;
    if (!c) return;
    const r = await api.answerIncomeChange(update, { newIncomeMinor: c.newIncomeMinor, periodStart: c.periodStart }).catch(() => ({ ok: false }));
    if (r.ok) {
      await invalidateForEvent(qc, 'BudgetsChanged');
      if (update) toast.show({ message: copy.budgets.targetsSaved });
    }
  };

  const dismissCard = async () => {
    await api.dismissTemplateCard().catch(() => undefined);
    await invalidateForEvent(qc, 'BudgetsChanged');
  };

  if (q.isError) return <Text style={[textStyle('body'), { color: theme.color('semantic-warning') }]}>{copy.budgets.loadError}</Text>;
  if (!data) return null;
  const rows = data.list.rows;

  if (compact) {
    const template = rows.filter((r) => r.group === '50_30_20');
    const others = rows.filter((r) => r.group !== '50_30_20').sort((a, b) => b.status.percentUsed - a.status.percentUsed).slice(0, 3);
    return (
      <View testID="budgets-compact" style={styles.list}>
        <SetupCard data={data} onSetUp={() => openTemplate(data, data.template.onboardingIncomeMinor)} onDismiss={() => void dismissCard()} />
        <IncomeCard data={data} onAnswer={(update) => void answerIncome(update, data)} />
        {[...template, ...others].map((r) => (
          <BudgetRow key={r.id} row={r} data={data} onPress={() => (onOpen ? onOpen(r.id) : void edit(r.id, data))} />
        ))}
        {rows.length > 0 && onSeeAll ? <Button label={copy.plan.seeAllBudgets} variant="text" testID="budgets-see-all" onPress={onSeeAll} /> : null}
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View testID="budgets-empty" style={styles.empty}>
        <Text style={[textStyle('body'), styles.center, { color: theme.color('text-primary') }]}>{copy.budgets.empty}</Text>
        <Button label={copy.budgets.add} testID="budgets-add" onPress={() => open({ mode: 'add' }, data)} />
        <SetupCard data={data} onSetUp={() => openTemplate(data, data.template.onboardingIncomeMinor)} onDismiss={() => void dismissCard()} />
        <Button label={copy.budgets.useTemplate} variant="secondary" testID="budgets-use-503020" onPress={() => (onUseTemplate ? onUseTemplate() : openTemplate(data, null))} />
      </View>
    );
  }

  return (
    <View testID="budgets-screen" style={styles.list}>
      <SetupCard data={data} onSetUp={() => openTemplate(data, data.template.onboardingIncomeMinor)} onDismiss={() => void dismissCard()} />
      <IncomeCard data={data} onAnswer={(update) => void answerIncome(update, data)} />
      <Button label={copy.budgets.add} variant="secondary" testID="budgets-add" onPress={() => open({ mode: 'add' }, data)} />
      <Button label={copy.budgets.useTemplate} variant="secondary" testID="budgets-use-503020" onPress={() => (onUseTemplate ? onUseTemplate() : openTemplate(data, null))} />
      {GROUPS.map(({ group, title }) => {
        const inGroup = rows.filter((r) => r.group === group);
        if (inGroup.length === 0) return null;
        return (
          <View key={group} testID={`budgets-group-${group}`} style={styles.group}>
            <Text accessibilityRole="header" style={[textStyle('label'), { color: theme.color('text-secondary') }]}>{title}</Text>
            {inGroup.map((r) => (
              <BudgetRow key={r.id} row={r} data={data} onPress={() => (onOpen ? onOpen(r.id) : void edit(r.id, data))} />
            ))}
            {group === '50_30_20' && data.list.typeSummary && data.list.typeSummary.notClassifiedMinor > 0 ? (
              <Pressable
                testID="budgets-not-classified"
                {...controlA11y({ label: `${copy.budgets.notClassified} ${moneyText(data.list.typeSummary.notClassifiedMinor, data.currency, data.locale)}. ${copy.budgets.sortIt}`, role: 'button' })}
                onPress={() => {
                  const t = data.list.typeSummary!;
                  onOpenActivity?.({ categoryIds: t.categoryIds, fromDate: t.period.start, toDate: t.period.end });
                }}
                style={styles.sortRow}>
                <Text style={[textStyle('body'), { color: theme.color('text-primary') }]}>{`${copy.budgets.notClassified} ${moneyText(data.list.typeSummary.notClassifiedMinor, data.currency, data.locale)} · ${copy.budgets.sortIt}`}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** `Your income changed — update 50/30/20 to ₹90,000?`: nothing changes until Update; either answer hides it until the next period. */
function IncomeCard({ data, onAnswer }: { data: BudgetsData; onAnswer: (update: boolean) => void }) {
  useAmountsHidden(); // re-render when Hide amounts is toggled: this component builds amount text and labels
  const theme = useTheme();
  const c = data.template.incomeChange;
  if (!c) return null;
  return (
    <View testID="income-card" style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{copy.budgets.incomeChanged.replace('{amount}', moneyText(c.newIncomeMinor, data.currency, data.locale))}</Text>
      <Button label={copy.budgets.updateIncome} testID="income-card-update" onPress={() => onAnswer(true)} />
      <Button label={copy.budgets.keepIncome.replace('{amount}', moneyText(c.oldIncomeMinor, data.currency, data.locale))} variant="text" testID="income-card-keep" onPress={() => onAnswer(false)} />
    </View>
  );
}

/** `You wanted to try 50/30/20`: shown when onboarding said Yes and nothing was set up. Dismissing is remembered. */
function SetupCard({ data, onSetUp, onDismiss }: { data: BudgetsData; onSetUp: () => void; onDismiss: () => void }) {
  const theme = useTheme();
  if (!data.template.showSetupCard) return null;
  return (
    <View testID="template-card" style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{copy.budgets.templateCard}</Text>
      <Button label={copy.budgets.setItUp} testID="template-card-setup" onPress={onSetUp} />
      <Button label={copy.budgets.dismiss} variant="text" testID="template-card-dismiss" onPress={onDismiss} />
    </View>
  );
}

function BudgetRow({ row, data, onPress }: { row: BudgetListRow; data: BudgetsData; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={`budget-row-${row.id}`}
      {...controlA11y({ label: `${row.name}, ${row.periodLabel}`, role: 'button' })}
      onPress={onPress}
      style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <LimitBar
        testID={`limit-${row.id}`}
        name={row.name}
        status={row.status}
        currency={data.currency}
        locale={data.locale}
        {...(row.group === '50_30_20' ? { tone: row.scope === 'savings' ? ('savings' as const) : row.budgetType === 'need' ? ('needs' as const) : ('wants' as const) } : {})}
        {...(row.scope === 'savings' ? { savings: true, movedOut: (row.savingsMovedMinor ?? 0) < 0 } : {})}
        {...(row.overlapsOverall ? { caption: copy.budgets.alsoCounted } : {})}
      />
      <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{row.periodLabel}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  empty: { gap: 12, alignItems: 'stretch', paddingVertical: 24 },
  center: { textAlign: 'center' },
  list: { gap: 16 },
  group: { gap: 8 },
  card: { borderWidth: 1, borderRadius: radii.md, padding: 12, gap: 6 },
  sortRow: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 4 },
});
