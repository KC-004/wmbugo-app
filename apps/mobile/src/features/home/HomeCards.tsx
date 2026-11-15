import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { CaretRight } from 'phosphor-react-native';
import { dayMonthLabel, defaultHomeLayout, shortDate, type ActivityQuery, type HomeLayoutEntry, type BudgetListRow, type CurrencyCode, type ComingUp, type HomeBudgetCards, type IncomeExpense, type SavingsGoalCard, type Spend7d, type TopCategories } from '@wmbugo/core';
import { amountLabel, controlA11y, spokenAmount } from '../../shared/a11y/labels';
import { useAmountsHidden } from '../../shared/state/amountsHidden';
import { copy } from '../../shared/copy';
import { ErrorBlock, Skeleton } from '../../shared/feedback/Feedback';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { BarChart, type BarDatum } from '../../shared/ui/BarChart';
import type { ColorName } from '../../shared/theme/colors';
import { categoryIcon } from '../add/categoryIcons';
import { Button } from '../../shared/ui/Button';
import { LimitBar, limitBarLabel, savingsLabel } from '../../shared/ui/LimitBar';
import { moneyText } from '../../shared/ui/moneyText';
import { REGISTERED_FOR_LAYOUT, visibleCards, type CardId } from './cardRegistry';
import type { HomeApi } from './homeApi';
import { GoalCard } from '../goals/GoalCard';
import { statusText } from '../bills/billText';
import { timelineAsRow } from '../plan/PlanHubScreen';

export const HOME_INCOME_KEY = ['home', 'income'] as const;
export const HOME_BUDGETS_KEY = ['home', 'budgets'] as const;
export const HOME_TOP_CATEGORIES_KEY = ['home', 'top-categories'] as const;
export const HOME_SPEND_7D_KEY = ['home', 'spend-7d'] as const;
export const HOME_COMING_UP_KEY = ['home', 'coming-up'] as const;
export const HOME_SAVINGS_GOAL_KEY = ['home', 'savings-goal'] as const;

export interface HomeCardsNav {
  onOpenReview: () => void;
  onOpenBudget: (budgetId: string, periodStart: string) => void;
  onOpenPlan: () => void;
  onOpenActivity: (query: ActivityQuery) => void;
  /** Coming up and Savings goal (Story 6.10): a bill's detail, a goal's detail, and the lists they come from. */
  onOpenBill?: (ruleId: string) => void;
  onOpenGoal?: (goalId: string) => void;
  onOpenGoals?: () => void;
}

/** A card: `bg-surface`, `rounded.md`, padding 16, no shadow; a heading title and the scope caption on the right. */
function CardFrame({ id, title, scope = copy.home.cards.thisPeriod, children }: { id: CardId; title: string; scope?: string | null; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View testID={`home-card-${id}`} style={[styles.card, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[textStyle('title-sm'), styles.title, { color: theme.color('text-primary') }]}>
          {title}
        </Text>
        {scope ? <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{scope}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function ToCheckCard({ count, onOpen }: { count: number; onOpen: () => void }) {
  const theme = useTheme();
  const title = copy.home.cards.toCheck.replace('{n}', String(count));
  return (
    <Pressable
      testID="home-card-to_check"
      {...controlA11y({ label: `${title}, ${copy.home.cards.waitingForYou}`, role: 'button' })}
      onPress={onOpen}
      style={[styles.card, styles.toCheck, { backgroundColor: theme.color('bg-surface'), borderColor: theme.color('border-hairline') }]}>
      <View style={styles.toCheckText}>
        <Text style={[textStyle('title-sm'), { color: theme.color('text-primary') }]}>{title}</Text>
        <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{copy.home.cards.waitingForYou}</Text>
      </View>
      <Icon icon={CaretRight} size={20} color="text-secondary" />
    </Pressable>
  );
}

function IncomeExpenseCard({ d, currency, locale, onOpenActivity }: { d: IncomeExpense; currency: CurrencyCode; locale: string; onOpenActivity: (q: ActivityQuery) => void }) {
  const theme = useTheme();
  useAmountsHidden(); // the spoken amounts below follow Hide amounts
  const { fontScale } = useWindowDimensions();
  const stack = fontScale >= 1.3;
  const range = { fromDate: d.period.start, toDate: d.period.end };
  const muted = { color: theme.color('text-secondary') };
  // `Net +₹76,860.00`, `Net ₹3,200.00 out`: the amount sits between the two pieces of the sentence.
  const netSpoken = spokenAmount(d.net.minor, currency, locale);
  const netLabel = d.net.kind === 'in' ? `Net, plus ${netSpoken}` : d.net.kind === 'out' ? `Net ${netSpoken} out` : `Net ${netSpoken}`;
  const netParts = (d.net.kind === 'out' ? copy.home.cards.netOut : copy.home.cards.net).split('{amount}');
  return (
    <CardFrame id="income_expense" title={copy.home.cards.incomeExpense}>
      <View testID="income-expense-row" style={[styles.pair, stack ? styles.column : styles.row]}>
        <Pressable testID="income-open" {...controlA11y({ label: `${copy.home.cards.income}, ${amountLabel({ amountMinor: d.incomeMinor, currency, locale, kind: 'income', inline: true }).replace(/^income, /, '')}`, role: 'button' })} onPress={() => onOpenActivity({ types: ['income'], ...range })} style={styles.cell}>
          <Text style={[textStyle('caption'), muted]}>{copy.home.cards.income}</Text>
          <Amount amountMinor={d.incomeMinor} currency={currency} direction="income" role="headline" color="semantic-income" locale={locale} testID="income-amount" />
        </Pressable>
        <Pressable testID="spent-open" {...controlA11y({ label: amountLabel({ amountMinor: d.spentMinor, currency, locale, kind: 'spent' }), role: 'button' })} onPress={() => onOpenActivity({ types: ['expense', 'refund'], ...range })} style={styles.cell}>
          <Text style={[textStyle('caption'), muted]}>{copy.home.cards.spent}</Text>
          <Amount amountMinor={d.spentMinor} currency={currency} direction="expense" role="headline" locale={locale} testID="spent-amount" />
        </Pressable>
      </View>
      <View testID="net-chip" accessible accessibilityLabel={netLabel} style={[styles.chip, { borderColor: theme.color('border-hairline') }]}>
        <Text style={[textStyle('label'), { color: theme.color('text-primary') }]}>{netParts[0]}</Text>
        <Amount amountMinor={d.net.minor} currency={currency} direction={d.net.kind === 'in' ? 'income' : 'neutral'} role="body-medium" color={d.net.kind === 'in' ? 'semantic-income' : 'text-primary'} locale={locale} />
        {netParts[1] ? <Text style={[textStyle('label'), { color: theme.color('text-primary') }]}>{netParts[1]}</Text> : null}
      </View>
    </CardFrame>
  );
}

function rowTone(row: BudgetListRow) {
  return row.group === '50_30_20' ? { tone: row.scope === 'savings' ? ('savings' as const) : row.budgetType === 'need' ? ('needs' as const) : ('wants' as const) } : {};
}

function BudgetRow({ row, currency, locale, ownPeriod, onOpen }: { row: BudgetListRow; currency: CurrencyCode; locale: string; ownPeriod: boolean; onOpen: () => void }) {
  const theme = useTheme();
  const hidden = useAmountsHidden();
  // The row is one button: it reads the whole bar (name, amounts, status, days) and the period it is on, never just its name.
  const spoken = row.scope === 'savings' ? savingsLabel(row.name, row.status, currency, locale, hidden, (row.savingsMovedMinor ?? 0) < 0) : limitBarLabel(row.name, row.status, currency, locale, hidden);
  return (
    <Pressable testID={`home-budget-${row.id}`} {...controlA11y({ label: `${spoken}, ${row.periodLabel}`, role: 'button' })} onPress={onOpen} style={styles.budgetRow}>
      <LimitBar
        testID={`home-limit-${row.id}`}
        name={row.name}
        status={row.status}
        currency={currency}
        locale={locale}
        {...rowTone(row)}
        {...(row.scope === 'savings' ? { savings: true, movedOut: (row.savingsMovedMinor ?? 0) < 0 } : {})}
      />
      {ownPeriod ? <Text style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>{row.periodLabel}</Text> : null}
    </Pressable>
  );
}

/** Compact Budgets shows the three with the highest percent used and a way to the rest. */
export const COMPACT_BUDGETS = 3;

function BudgetsCard({ cards, currency, locale, compact, onOpenBudget, onOpenPlan }: { cards: HomeBudgetCards; currency: CurrencyCode; locale: string; compact: boolean; onOpenBudget: HomeCardsNav['onOpenBudget']; onOpenPlan: () => void }) {
  const own = (r: BudgetListRow) => r.period.start !== cards.defaultPeriod.start || r.period.end !== cards.defaultPeriod.end;
  const rows = compact ? cards.categoryBudgets.slice(0, COMPACT_BUDGETS) : cards.categoryBudgets;
  return (
    <CardFrame id="budgets" title={copy.home.cards.budgets}>
      <View style={styles.rows}>
        {rows.map((r) => (
          <BudgetRow key={r.id} row={r} currency={currency} locale={locale} ownPeriod={own(r)} onOpen={() => onOpenBudget(r.id, r.period.start)} />
        ))}
      </View>
      {compact && cards.categoryBudgets.length > COMPACT_BUDGETS ? <Button label={copy.home.edit.seeAllBudgets} variant="text" onPress={onOpenPlan} testID="home-see-all-budgets" /> : null}
    </CardFrame>
  );
}

function NwsCard({ cards, currency, locale, onOpenPlan, onOpenActivity }: { cards: HomeBudgetCards; currency: CurrencyCode; locale: string; onOpenPlan: () => void; onOpenActivity: HomeCardsNav['onOpenActivity'] }) {
  const theme = useTheme();
  const nws = cards.nws!;
  const t = nws.typeSummary;
  return (
    <CardFrame id="nws" title={copy.home.cards.nws}>
      <View style={styles.rows}>
        {nws.rows.map((r) => (
          <BudgetRow key={r.id} row={r} currency={currency} locale={locale} ownPeriod={false} onOpen={onOpenPlan} />
        ))}
      </View>
      {t && t.notClassifiedMinor > 0 ? (
        <Pressable
          testID="home-not-classified"
          {...controlA11y({ label: `${copy.budgets.notClassified} ${moneyText(t.notClassifiedMinor, currency, locale)}. ${copy.budgets.sortIt}`, role: 'button' })}
          onPress={() => onOpenActivity({ categoryIds: t.categoryIds, fromDate: t.period.start, toDate: t.period.end })}
          style={styles.sortRow}>
          <Text style={[textStyle('body'), { color: theme.color('text-primary') }]}>{`${copy.budgets.notClassified} ${moneyText(t.notClassifiedMinor, currency, locale)} · ${copy.budgets.sortIt}`}</Text>
        </Pressable>
      ) : null}
    </CardFrame>
  );
}

/** The 40dp category chip drawn before a bar's name: the category icon in its own colour. */
function CategoryChip({ icon, colorToken }: { icon: string; colorToken: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.catChip, { backgroundColor: theme.color('bg-muted') }]}>
      <Icon icon={categoryIcon(icon)} size={22} color={colorToken as ColorName} />
    </View>
  );
}

/** Compact Top categories shows the top three. */
export const COMPACT_TOP_CATEGORIES = 3;

function TopCategoriesCard({ d, currency, locale, compact, table, onToggleTable, onOpenActivity }: { d: TopCategories; currency: CurrencyCode; locale: string; compact: boolean; table: boolean; onToggleTable: () => void; onOpenActivity: (q: ActivityQuery) => void }) {
  const theme = useTheme();
  if (d.rows.length === 0) {
    return (
      <CardFrame id="top_categories" title={copy.home.cards.topCategories}>
        <Text testID="top-categories-empty" style={[textStyle('body'), { color: theme.color('text-secondary') }]}>
          {copy.home.cards.nothingSpent}
        </Text>
      </CardFrame>
    );
  }
  const data: BarDatum[] = (compact ? d.rows.slice(0, COMPACT_TOP_CATEGORIES) : d.rows).map((r) => ({ id: r.categoryId, label: r.name, valueMinor: r.amountMinor, sharePercent: r.sharePercent, leading: <CategoryChip icon={r.icon} colorToken={r.colorToken} /> }));
  return (
    <CardFrame id="top_categories" title={copy.home.cards.topCategories} scope={null}>
      <BarChart
        testID="top-categories-chart"
        title={copy.home.cards.topCategories}
        scope={copy.home.cards.thisPeriod}
        data={data}
        currency={currency}
        locale={locale}
        orientation="horizontal"
        table={table}
        onToggleTable={onToggleTable}
        onPressDatum={(b) => {
          const row = d.rows.find((r) => r.categoryId === b.id);
          if (row) onOpenActivity({ categoryIds: row.categoryIds, fromDate: d.period.start, toDate: d.period.end });
        }}
      />
    </CardFrame>
  );
}

function Spend7dCard({ d, currency, locale, table, onToggleTable, onOpenActivity }: { d: Spend7d; currency: CurrencyCode; locale: string; table: boolean; onToggleTable: () => void; onOpenActivity: (q: ActivityQuery) => void }) {
  const theme = useTheme();
  const data: BarDatum[] = d.days.map((x) => ({ id: x.date, label: x.label, valueMinor: x.spentMinor }));
  return (
    <CardFrame id="spend_7d" title={copy.home.cards.spendLastWeek} scope={null}>
      <BarChart
        testID="spend-7d-chart"
        title={copy.home.cards.spendLastWeek}
        scope={copy.home.cards.lastSevenDays}
        data={data}
        currency={currency}
        locale={locale}
        orientation="vertical"
        table={table}
        onToggleTable={onToggleTable}
        onPressDatum={(b) => onOpenActivity({ fromDate: b.id, toDate: b.id })}
      />
      {d.since ? (
        <Text testID="spend-7d-since" style={[textStyle('caption'), { color: theme.color('text-secondary') }]}>
          {copy.home.cards.since.replace('{date}', shortDate(d.since))}
        </Text>
      ) : null}
    </CardFrame>
  );
}

function ComingUpCard({ d, currency, locale, nav }: { d: ComingUp; currency: CurrencyCode; locale: string; nav: HomeCardsNav }) {
  const theme = useTheme();
  useAmountsHidden(); // the amounts below follow Hide amounts
  const when = d.payCycle ? 'payday' : 'month-end';
  const c = copy.home.cards;
  return (
    <CardFrame id="coming_up" title={c.comingUp} scope={d.payCycle ? c.beforePayday : c.beforeMonthEnd}>
      {d.items.length === 0 ? (
        <Text testID="coming-up-empty" style={[textStyle('body'), { color: theme.color('text-secondary') }]}>{c.nothingDue.replace('{when}', when)}</Text>
      ) : (
        <View style={styles.rows}>
          {d.items.map((i) => {
            const s = statusText(timelineAsRow(i).status);
            const label = `${i.title}, ${dayMonthLabel(i.dueDate)}, ${amountLabel({ amountMinor: i.expectedAmountMinor, currency, locale, inline: true })}, ${s.text}`;
            return (
              <Pressable key={`${i.ruleId}-${i.dueDate}`} testID={`coming-up-${i.ruleId}-${i.dueDate}`} {...controlA11y({ label, role: 'button' })} onPress={() => nav.onOpenBill?.(i.ruleId)} style={styles.comingRow}>
                <View style={styles.comingText}>
                  <Text style={[textStyle('body-medium'), { color: theme.color('text-primary') }]}>{`${i.title} · ${dayMonthLabel(i.dueDate)}`}</Text>
                  <Text style={[textStyle('caption'), { color: theme.color(s.tone === 'warning' ? 'semantic-warning' : 'text-secondary') }]}>{s.text}</Text>
                </View>
                <Amount amountMinor={i.expectedAmountMinor} currency={currency} direction="neutral" role="body" locale={locale} />
              </Pressable>
            );
          })}
        </View>
      )}
      {d.moreCount > 0 ? <Button label={c.moreBills.replace('{n}', String(d.moreCount))} variant="text" testID="coming-up-more" onPress={nav.onOpenPlan} /> : null}
    </CardFrame>
  );
}

function SavingsGoalHomeCard({ d, currency, locale, nav }: { d: SavingsGoalCard; currency: CurrencyCode; locale: string; nav: HomeCardsNav }) {
  const c = copy.home.cards;
  return (
    <CardFrame id="savings_goal" title={c.savingsGoal} scope={null}>
      <GoalCard bare goal={d.goal} currency={currency} locale={locale} onPress={() => nav.onOpenGoal?.(d.goal.id)} />
      {d.moreCount > 0 ? <Button label={d.moreCount === 1 ? c.moreGoalOne : c.moreGoals.replace('{n}', String(d.moreCount))} variant="text" testID="savings-goal-more" onPress={() => nav.onOpenGoals?.()} /> : null}
    </CardFrame>
  );
}

function CardError({ id, title, onRetry }: { id: CardId; title: string; onRetry: () => void }) {
  return (
    <CardFrame id={id} title={title} scope={null}>
      <ErrorBlock cause={copy.home.cardError} onRetry={onRetry} />
    </CardFrame>
  );
}

/**
 * The cards under the hero, in registry order (Story 5.4). Each card reads its own query, so one that fails shows its own
 * error with Retry and the others carry on. The `N to check` count comes with the hero snapshot.
 */
export function HomeCards({ api, toCheckCount, currency, locale, nav, layout = defaultHomeLayout(REGISTERED_FOR_LAYOUT), layoutReady = true }: { api: HomeApi; toCheckCount: number; currency: CurrencyCode; locale: string; nav: HomeCardsNav; /** The resolved layout (Story 5.6): order, hidden and size per editable card. */ layout?: readonly HomeLayoutEntry[]; /** False until the saved layout is known, so the cards never show in the PRD order and then jump. */ layoutReady?: boolean }) {
  const compactOf = (id: CardId) => layout.find((e) => e.cardId === id)?.size === 'compact';
  // `View as table` is remembered per chart for as long as Home is open: opening an entry list from a bar and coming back
  // leaves Home unchanged (Story 5.5). A new Home (the app reopened) starts on the bars.
  const [tables, setTables] = useState<Partial<Record<CardId, boolean>>>({});
  const toggle = (id: CardId) => () => setTables((t) => ({ ...t, [id]: !t[id] }));
  const isOn = (id: CardId) => !layout.find((e) => e.cardId === id)?.hidden;
  const income = useQuery({ queryKey: HOME_INCOME_KEY, enabled: isOn('income_expense'), queryFn: async () => (api.loadIncomeExpense ? await api.loadIncomeExpense() : null) });
  const topCategories = useQuery({ queryKey: HOME_TOP_CATEGORIES_KEY, enabled: isOn('top_categories'), queryFn: async () => (api.loadTopCategories ? await api.loadTopCategories() : null) });
  const spend7d = useQuery({ queryKey: HOME_SPEND_7D_KEY, enabled: isOn('spend_7d'), queryFn: async () => (api.loadSpend7d ? await api.loadSpend7d() : null) });
  const comingUp = useQuery({ queryKey: HOME_COMING_UP_KEY, enabled: isOn('coming_up'), queryFn: async () => (api.loadComingUp ? await api.loadComingUp() : null) });
  const savingsGoal = useQuery({ queryKey: HOME_SAVINGS_GOAL_KEY, enabled: isOn('savings_goal'), queryFn: async () => (api.loadSavingsGoal ? await api.loadSavingsGoal() : null) });
  const budgets = useQuery({ queryKey: HOME_BUDGETS_KEY, enabled: isOn('budgets') || isOn('nws'), queryFn: async () => (api.loadBudgetCards ? await api.loadBudgetCards() : null) });
  // A card keeps its last good data when a refresh fails (the hero says so); an error shows only when there is nothing to show.
  const inputs = { toCheckCount, ...(income.data !== undefined ? { income: income.data } : {}), ...(budgets.data !== undefined ? { budgets: budgets.data } : {}), ...(topCategories.data !== undefined ? { topCategories: topCategories.data } : {}), ...(spend7d.data !== undefined ? { spend7d: spend7d.data } : {}), ...(comingUp.data !== undefined ? { comingUp: comingUp.data } : {}), ...(savingsGoal.data !== undefined ? { savingsGoal: savingsGoal.data } : {}) };
  const shown = new Set(visibleCards(inputs).map((c) => c.id));
  const budgetsFailed = budgets.isError && budgets.data === undefined;

  const render = (id: CardId): ReactNode => {
    switch (id) {
      case 'to_check':
        return <ToCheckCard key={id} count={toCheckCount} onOpen={nav.onOpenReview} />;
      case 'income_expense':
        if (income.data) return <IncomeExpenseCard key={id} d={income.data} currency={currency} locale={locale} onOpenActivity={nav.onOpenActivity} />;
        if (income.isError) return <CardError key={id} id={id} title={copy.home.cards.incomeExpense} onRetry={() => void income.refetch()} />;
        return <Skeleton key={id} height={96} />;
      case 'budgets':
        if (budgets.data) return <BudgetsCard key={id} cards={budgets.data} currency={currency} locale={locale} compact={compactOf('budgets')} onOpenBudget={nav.onOpenBudget} onOpenPlan={nav.onOpenPlan} />;
        if (budgetsFailed) return <CardError key={id} id={id} title={copy.home.cards.budgets} onRetry={() => void budgets.refetch()} />;
        return <Skeleton key={id} height={96} />;
      case 'top_categories':
        if (topCategories.data) return <TopCategoriesCard key={id} d={topCategories.data} currency={currency} locale={locale} compact={compactOf('top_categories')} table={!!tables[id]} onToggleTable={toggle(id)} onOpenActivity={nav.onOpenActivity} />;
        if (topCategories.isError) return <CardError key={id} id={id} title={copy.home.cards.topCategories} onRetry={() => void topCategories.refetch()} />;
        return <Skeleton key={id} height={120} />;
      case 'spend_7d':
        if (spend7d.data) return <Spend7dCard key={id} d={spend7d.data} currency={currency} locale={locale} table={!!tables[id]} onToggleTable={toggle(id)} onOpenActivity={nav.onOpenActivity} />;
        if (spend7d.isError) return <CardError key={id} id={id} title={copy.home.cards.spendLastWeek} onRetry={() => void spend7d.refetch()} />;
        return <Skeleton key={id} height={160} />;
      case 'coming_up':
        return comingUp.data ? <ComingUpCard key={id} d={comingUp.data} currency={currency} locale={locale} nav={nav} /> : null;
      case 'savings_goal':
        return savingsGoal.data ? <SavingsGoalHomeCard key={id} d={savingsGoal.data} currency={currency} locale={locale} nav={nav} /> : null;
      case 'nws':
        return budgets.data?.nws ? <NwsCard key={id} cards={budgets.data} currency={currency} locale={locale} onOpenPlan={nav.onOpenPlan} onOpenActivity={nav.onOpenActivity} /> : null;
    }
  };

  // Registry order. The Budgets slot also holds its skeleton while loading and its error if the load failed.
  // `N to check` is always first; the rest follow the saved order, hidden cards left out.
  const order: CardId[] = layoutReady ? ['to_check', ...layout.filter((e) => !e.hidden).map((e) => e.cardId as CardId)] : ['to_check'];
  const slots = order.filter((id) => (id === 'budgets' ? shown.has('budgets') || budgetsFailed || budgets.isPending : shown.has(id)));
  return (
    <View testID="home-cards" style={styles.stack}>
      {slots.map((id) => render(id))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12, marginTop: 16 },
  card: { borderWidth: 1, borderRadius: radii.md, padding: 16, gap: 12 },
  head: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', columnGap: 8 },
  title: { flexShrink: 1 },
  toCheck: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  toCheckText: { flexShrink: 1, gap: 2 },
  pair: { gap: 12 },
  row: { flexDirection: 'row' },
  column: { flexDirection: 'column' },
  cell: { flex: 1, minHeight: 48, gap: 2, justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'baseline', alignSelf: 'flex-start', borderWidth: 1, borderRadius: radii.sm, paddingHorizontal: 8, paddingVertical: 4 },
  rows: { gap: 16 },
  budgetRow: { gap: 4 },
  sortRow: { minHeight: 48, justifyContent: 'center' },
  comingRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, minHeight: 48 },
  comingText: { flexShrink: 1, gap: 2 },
  catChip: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
