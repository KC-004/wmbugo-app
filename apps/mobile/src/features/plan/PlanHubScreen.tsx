import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { CaretRight } from 'phosphor-react-native';
import { addDays, dayMonthLabel, type BillRowModel, type GoalRow, type TimelineItem } from '@wmbugo/core';
import { controlA11y } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import { Skeleton } from '../../shared/feedback/Feedback';
import { useUiStore } from '../../shared/state/uiStore';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Button } from '../../shared/ui/Button';
import { BillRow } from '../bills/BillRow';
import { BILLS_QUERY_KEY, realBillsApi, type BillsApi } from '../bills/billsApi';
import { cadenceText } from '../bills/billText';
import { useBillActions } from '../bills/useBillActions';
import { BudgetsScreen } from '../budgets/BudgetsScreen';
import { BUDGETS_QUERY_KEY, realBudgetsApi, type BudgetsApi } from '../budgets/budgetsApi';
import { GoalCard } from '../goals/GoalCard';
import { GOALS_QUERY_KEY, realGoalsApi, type GoalsApi } from '../goals/goalsApi';
import { useGoalActions } from '../goals/useGoalActions';
import { FreeToUseTile } from './FreeToUseTile';
import { PLAN_TIMELINE_KEY, realPlanApi, type PlanApi } from './planApi';

const p = copy.plan;

/** The timeline row's date label: `Today`, `Tomorrow` or `5 Dec`. */
export const leadLabel = (date: string, today: string): string => (date === today ? p.today : addDays(today, 1) === date ? p.tomorrow : dayMonthLabel(date));

/** A timeline item as a bill row: the same status line (REC-004) and the same row, with a leading date. */
export function timelineAsRow(i: TimelineItem): BillRowModel {
  const status: BillRowModel['status'] =
    i.status === 'paid'
      ? { kind: 'paid', date: i.dueDate, daysUntilDue: null, paidBy: i.paidBy, paidOn: i.paidOn }
      : i.status === 'not_seen_yet'
        ? { kind: 'not_seen_yet', date: i.dueDate, daysUntilDue: null, paidBy: null }
        : i.status === 'due_soon'
          ? { kind: 'due_soon', date: i.dueDate, daysUntilDue: i.daysUntilDue, paidBy: null }
          : { kind: 'upcoming', date: i.dueDate, daysUntilDue: null, paidBy: null };
  return {
    id: `${i.ruleId}-${i.dueDate}`,
    title: i.title,
    kind: i.kind,
    cadence: i.cadence as BillRowModel['cadence'],
    customEvery: i.customEvery,
    customUnit: i.customUnit as BillRowModel['customUnit'],
    expectedAmountMinor: i.expectedAmountMinor,
    accountId: null,
    accountName: i.accountName,
    categoryId: null,
    categoryName: null,
    categoryIcon: i.categoryIcon,
    categoryColor: i.categoryColor,
    state: 'active',
    nextDue: i.dueDate,
    status,
    hasPayments: i.status === 'paid',
    monthlyEquivalentMinor: 0,
  };
}

/** A setup card (UX-DR58): a dashed outline, a title, one sentence and one button. Not dismissible. */
function SetupCard({ title, body, action, onPress, testID }: { title: string; body: string; action: string; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={[styles.setup, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-control') }]}>
      <Text accessibilityRole="header" style={[textStyle('title'), { color: theme.color('text-primary') }]}>{title}</Text>
      <Text style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{body}</Text>
      <Button label={action} variant="text" testID={`${testID}-action`} onPress={onPress} />
    </View>
  );
}

function SectionError({ onRetry, testID }: { onRetry: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} accessibilityRole="alert" style={styles.sectionError}>
      <Text style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{p.sectionError}</Text>
      <Button label={p.retry} variant="text" testID={`${testID}-retry`} onPress={onRetry} />
    </View>
  );
}

function Section({ title, children, testID }: { title: string; children: ReactNode; testID: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={styles.section}>
      <Text accessibilityRole="header" style={[textStyle('title'), { color: theme.color('text-primary') }]}>{title}</Text>
      {children}
    </View>
  );
}

function LinkRow({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable testID={testID} {...controlA11y({ label, role: 'button' })} onPress={onPress} style={[styles.link, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <Text style={[textStyle('body-medium'), { color: theme.color('text-primary'), flexShrink: 1 }]}>{label}</Text>
      <Icon icon={CaretRight} size={18} color="text-secondary" />
    </Pressable>
  );
}

export interface PlanHubNav {
  onOpenBills: () => void;
  onOpenBill: (ruleId: string) => void;
  onOpenGoals: () => void;
  onOpenGoal: (goalId: string) => void;
  onOpenBudgets: () => void;
  onOpenBudget: (budgetId: string) => void;
  /** Accounts (SCR-06), for Free to use's `Add an account` and its breakdown. */
  onOpenAccounts: () => void;
  onOpenActivity?: Parameters<typeof BudgetsScreen>[0]['onOpenActivity'];
}

/**
 * SCR-13 Plan hub (Story 6.8): `Before payday` (the bills you added, in date order), then Budgets, Bills & recurring and Goals.
 * Each section loads and fails on its own, so one failing query never blanks the rest. With nothing set up it shows the three
 * setup cards; each goes once its thing exists. Bills and goals never change a balance, spending or a budget.
 */
export function PlanHubScreen({
  plan = realPlanApi,
  billsApi = realBillsApi,
  goalsApi = realGoalsApi,
  budgetsApi = realBudgetsApi,
  onOpenBills,
  onOpenBill,
  onOpenGoals,
  onOpenGoal,
  onOpenBudgets,
  onOpenBudget,
  onOpenAccounts,
  onOpenActivity,
}: PlanHubNav & { plan?: PlanApi; billsApi?: BillsApi; goalsApi?: GoalsApi; budgetsApi?: BudgetsApi }) {
  const theme = useTheme();
  const tl = useQuery({ queryKey: PLAN_TIMELINE_KEY, queryFn: () => plan.loadTimeline() });
  const budgetsQ = useQuery({ queryKey: BUDGETS_QUERY_KEY, queryFn: () => budgetsApi.load() });
  const billsQ = useQuery({ queryKey: BILLS_QUERY_KEY, queryFn: () => billsApi.load() });
  const goalsQ = useQuery({ queryKey: GOALS_QUERY_KEY, queryFn: () => goalsApi.load() });
  const billActions = useBillActions(billsApi);
  const goalActions = useGoalActions(goalsApi, goalsQ.data ?? { currency: 'INR', locale: 'en-IN', exponent: 2 });
  const requestBudgetEditor = () => useUiStore.getState().requestBudgetEditor();

  const timeline = tl.data?.timeline ?? null;
  const when = timeline?.period.payCycle === false ? 'month-end' : 'payday';
  const billTotal = billsQ.data ? billsQ.data.list.active.length + billsQ.data.list.paused.length + billsQ.data.list.ended.length : null;
  const goalCount = goalsQ.data ? goalsQ.data.goals.length : null;
  const budgetCount = budgetsQ.data ? budgetsQ.data.list.rows.length : null;
  const addBill = (prefill?: { title?: string; kind?: 'rent' }) => {
    const d = billsQ.data;
    if (d) billActions.openEditor({ mode: 'add', ...(prefill ? { prefill } : {}) }, { exponent: d.exponent, categories: d.categories, accounts: d.accounts, notificationsDenied: d.notificationsDenied });
  };
  const addGoal = () => {
    const d = goalsQ.data;
    if (d) goalActions.openEditor(null, d.accounts, d.thisMonth);
  };

  const daysText = timeline ? (timeline.period.daysLeft === 1 ? p.dayLeft : p.daysLeft.replace('{n}', String(timeline.period.daysLeft))) : '';

  const timelineBody = () => {
    if (tl.isError) return <SectionError testID="plan-timeline-error" onRetry={() => void tl.refetch()} />;
    if (!timeline || !tl.data) {
      return (
        <View testID="plan-timeline-loading" style={styles.gap}>
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      );
    }
    return (
      <View style={styles.gap}>
        <Text testID="plan-period" style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{p.periodCaption.replace('{label}', timeline.period.label).replace('{days}', daysText)}</Text>
        {timeline.activeBills === 0 ? <Text testID="plan-no-active" style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{p.noActiveBills}</Text> : null}
        {timeline.items.length === 0 && timeline.activeBills > 0 ? <Text testID="plan-nothing-due" style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{p.nothingDue.replace('{when}', when)}</Text> : null}
        {timeline.items.map((i) => (
          <BillRow
            key={`${i.ruleId}-${i.dueDate}`}
            row={timelineAsRow(i)}
            currency={tl.data!.currency}
            locale={tl.data!.locale}
            lead={leadLabel(i.dueDate, timeline.today)}
            caption={[i.accountName, cadenceText({ cadence: i.cadence as BillRowModel['cadence'], customEvery: i.customEvery, customUnit: i.customUnit as BillRowModel['customUnit'] })].filter(Boolean).join(' · ')}
            dim={i.status === 'paid'}
            onPress={() => onOpenBill(i.ruleId)}
          />
        ))}
        {timeline.activeBills > 0 ? (
          <View style={styles.footerRow}>
            <Text testID="plan-showing" style={[textStyle('caption'), { color: theme.color('text-secondary'), flexShrink: 1 }]}>{timeline.activeBills === 1 ? p.showingOne : p.showingMany.replace('{n}', String(timeline.activeBills))}</Text>
            {billsQ.data ? <Button label={p.addThem} variant="text" testID="plan-add-them" onPress={() => addBill()} /> : null}
          </View>
        ) : null}
      </View>
    );
  };

  const billsSummary = (): string | null => {
    if (!timeline) return null;
    if (timeline.activeBills === 0) return p.billsPausedOnly;
    const count = timeline.activeBills === 1 ? p.billsCountOne : p.billsCountMany.replace('{n}', String(timeline.activeBills));
    return timeline.nextBill ? p.billsSummary.replace('{count}', count).replace('{name}', timeline.nextBill.title).replace('{date}', dayMonthLabel(timeline.nextBill.dueDate)) : count;
  };

  const goals: readonly GoalRow[] = goalsQ.data ? goalsQ.data.goals.filter((g) => g.state === 'active' || g.state === 'paused') : [];
  const nothingYet = billTotal === 0 && goalCount === 0 && budgetCount === 0;

  return (
    <ScrollView testID="plan-hub" contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <FreeToUseTile plan={plan} nav={{ onSetLimit: requestBudgetEditor, onOpenAccounts, onOpenBudget, onOpenBudgets, onOpenBills, onOpenGoals }} />
      <Section title={timeline?.period.payCycle === false ? p.beforeMonthEnd : p.beforePayday} testID="plan-timeline">
        {billTotal === 0 ? (
          nothingYet ? (
            <SetupCard testID="plan-setup-rent" title={p.rentTitle} body={p.rentBody.replace('{when}', when)} action={p.rentAction} onPress={() => addBill({ title: 'Rent', kind: 'rent' })} />
          ) : (
            <SetupCard testID="plan-setup-upcoming" title={p.upcomingTitle} body={p.upcomingBody.replace('{when}', when)} action={copy.bills.add} onPress={() => addBill()} />
          )
        ) : (
          timelineBody()
        )}
      </Section>

      <Section title={p.budgetsSection} testID="plan-budgets">
        {budgetCount === 0 ? <SetupCard testID="plan-setup-budget" title={p.budgetTitle} body={p.budgetBody} action={p.budgetAction} onPress={requestBudgetEditor} /> : null}
        <BudgetsScreen api={budgetsApi} compact onSeeAll={onOpenBudgets} onOpen={onOpenBudget} {...(onOpenActivity ? { onOpenActivity } : {})} />
      </Section>

      {billTotal !== null && billTotal > 0 ? (
        <Section title={p.billsSection} testID="plan-bills">
          {billsSummary() ? <LinkRow testID="plan-open-bills" label={billsSummary()!} onPress={onOpenBills} /> : <LinkRow testID="plan-open-bills" label={p.billsSection} onPress={onOpenBills} />}
        </Section>
      ) : billsQ.isError ? (
        <Section title={p.billsSection} testID="plan-bills">
          <SectionError testID="plan-bills-error" onRetry={() => void billsQ.refetch()} />
        </Section>
      ) : null}

      {goalsQ.isError ? (
        <Section title={p.goalsSection} testID="plan-goals">
          <SectionError testID="plan-goals-error" onRetry={() => void goalsQ.refetch()} />
        </Section>
      ) : goalCount === 0 ? (
        <Section title={p.goalsSection} testID="plan-goals">
          <SetupCard testID="plan-setup-goal" title={p.goalTitle} body={p.goalBody} action={p.goalAction} onPress={addGoal} />
        </Section>
      ) : goals.length > 0 && goalsQ.data ? (
        <Section title={p.goalsSection} testID="plan-goals">
          {goals.slice(0, 3).map((g) => (
            <GoalCard key={g.id} goal={g} currency={goalsQ.data!.currency} locale={goalsQ.data!.locale} thisMonth={goalsQ.data!.thisMonth} onPress={() => onOpenGoal(g.id)} />
          ))}
          <Button label={p.seeAllGoals} variant="text" testID="plan-see-all-goals" onPress={onOpenGoals} />
        </Section>
      ) : goalCount !== null && goalCount > 0 ? (
        // Every goal is Done or Archived: the section stays, so they can still be reached.
        <Section title={p.goalsSection} testID="plan-goals">
          <LinkRow testID="plan-see-all-goals" label={p.seeAllGoals} onPress={onOpenGoals} />
        </Section>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 120, gap: 24 },
  section: { gap: 12 },
  gap: { gap: 12 },
  setup: { borderWidth: 1, borderStyle: 'dashed', borderRadius: radii.md, padding: 16, gap: 8 },
  sectionError: { gap: 4 },
  footerRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, paddingHorizontal: 12, borderWidth: 1, borderRadius: radii.md, gap: 8 },
});
