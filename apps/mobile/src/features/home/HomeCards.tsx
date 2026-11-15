import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { CaretRight } from 'phosphor-react-native';
import type { ActivityQuery, BudgetListRow, CurrencyCode, HomeBudgetCards, IncomeExpense } from '@wmbugo/core';
import { amountLabel, controlA11y, spokenAmount } from '../../shared/a11y/labels';
import { useAmountsHidden } from '../../shared/state/amountsHidden';
import { copy } from '../../shared/copy';
import { ErrorBlock, Skeleton } from '../../shared/feedback/Feedback';
import { Icon } from '../../shared/theme/Icon';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radii } from '../../shared/theme/tokens';
import { textStyle } from '../../shared/theme/typography';
import { Amount } from '../../shared/ui/Amount';
import { LimitBar, limitBarLabel, savingsLabel } from '../../shared/ui/LimitBar';
import { moneyText } from '../../shared/ui/moneyText';
import { HOME_CARDS, visibleCards, type CardId } from './cardRegistry';
import type { HomeApi } from './homeApi';

export const HOME_INCOME_KEY = ['home', 'income'] as const;
export const HOME_BUDGETS_KEY = ['home', 'budgets'] as const;

export interface HomeCardsNav {
  onOpenReview: () => void;
  onOpenBudget: (budgetId: string, periodStart: string) => void;
  onOpenPlan: () => void;
  onOpenActivity: (query: ActivityQuery) => void;
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

function BudgetsCard({ cards, currency, locale, onOpenBudget }: { cards: HomeBudgetCards; currency: CurrencyCode; locale: string; onOpenBudget: HomeCardsNav['onOpenBudget'] }) {
  const own = (r: BudgetListRow) => r.period.start !== cards.defaultPeriod.start || r.period.end !== cards.defaultPeriod.end;
  return (
    <CardFrame id="budgets" title={copy.home.cards.budgets}>
      <View style={styles.rows}>
        {cards.categoryBudgets.map((r) => (
          <BudgetRow key={r.id} row={r} currency={currency} locale={locale} ownPeriod={own(r)} onOpen={() => onOpenBudget(r.id, r.period.start)} />
        ))}
      </View>
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
export function HomeCards({ api, toCheckCount, currency, locale, nav }: { api: HomeApi; toCheckCount: number; currency: CurrencyCode; locale: string; nav: HomeCardsNav }) {
  const income = useQuery({ queryKey: HOME_INCOME_KEY, queryFn: async () => (api.loadIncomeExpense ? await api.loadIncomeExpense() : null) });
  const budgets = useQuery({ queryKey: HOME_BUDGETS_KEY, queryFn: async () => (api.loadBudgetCards ? await api.loadBudgetCards() : null) });
  // A card keeps its last good data when a refresh fails (the hero says so); an error shows only when there is nothing to show.
  const inputs = { toCheckCount, ...(income.data !== undefined ? { income: income.data } : {}), ...(budgets.data !== undefined ? { budgets: budgets.data } : {}) };
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
        if (budgets.data) return <BudgetsCard key={id} cards={budgets.data} currency={currency} locale={locale} onOpenBudget={nav.onOpenBudget} />;
        if (budgetsFailed) return <CardError key={id} id={id} title={copy.home.cards.budgets} onRetry={() => void budgets.refetch()} />;
        return <Skeleton key={id} height={96} />;
      case 'nws':
        return budgets.data?.nws ? <NwsCard key={id} cards={budgets.data} currency={currency} locale={locale} onOpenPlan={nav.onOpenPlan} onOpenActivity={nav.onOpenActivity} /> : null;
    }
  };

  // Registry order. The Budgets slot also holds its skeleton while loading and its error if the load failed.
  const slots = HOME_CARDS.filter((c) => (c.id === 'budgets' ? shown.has('budgets') || budgetsFailed || budgets.isPending : shown.has(c.id)));
  return (
    <View testID="home-cards" style={styles.stack}>
      {slots.map((c) => render(c.id))}
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
});
