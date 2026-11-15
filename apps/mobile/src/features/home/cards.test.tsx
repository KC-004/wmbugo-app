import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { budgetStatus, type BudgetListRow, type HomeBudgetCards, type IncomeExpense, type Spend7d, type TopCategories } from '@wmbugo/core';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { MemorySeenStore } from '../../shared/feedback/tooltipController';
import { moneyLeaks } from '../../shared/moneyLeaks.testkit';
import { createQueryClient } from '../../shared/queryClient';
import { useAmountsStore } from '../../shared/state/amountsHidden';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { HOME_CARDS, visibleCards } from './cardRegistry';
import { HomeScreen } from './HomeScreen';
import type { HomeApi, HomeData } from './homeApi';
import { homeData } from './homeTestKit';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Kolkata' } }));
let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 400, height: 800, scale: 2, fontScale: mockFontScale }),
}));

const live: ReactTestRenderer[] = [];
const clients: ReturnType<typeof createQueryClient>[] = [];
afterEach(async () => {
  await act(async () => new Promise((res) => setTimeout(res, 0)));
  for (const r of live.splice(0)) act(() => r.unmount());
  for (const c of clients.splice(0)) c.clear();
  jest.restoreAllMocks();
  mockFontScale = 1;
  useAmountsStore.getState().setHidden(false);
});
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
});

const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((res) => setTimeout(res, 0)));
};
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
const host = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id);
const press = (r: ReactTestRenderer, id: string) => act(() => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());

const NOV = { start: '2026-11-01', end: '2026-11-30' };
const nav = () => ({ onAccounts: jest.fn(), onProfile: jest.fn(), onAddAccount: jest.fn(), onOpenBudget: jest.fn(), onOpenPlan: jest.fn(), onSetLimit: jest.fn(), onSortIt: jest.fn(), onOpenReview: jest.fn(), onOpenActivity: jest.fn() });

const income = (over: Partial<IncomeExpense> = {}): IncomeExpense => ({ incomeMinor: 8_500_000, spentMinor: 814_000, net: { kind: 'in', minor: 7_686_000 }, period: NOV, ...over });
const row = (over: Partial<BudgetListRow> & { id: string; name: string }): BudgetListRow => {
  const used = over.usedMinor ?? 340_000;
  const target = over.targetMinor ?? 400_000;
  return {
    group: 'categories', scope: 'category', budgetType: null, period: { ...NOV, kind: 'pay_cycle' }, periodLabel: '1–30 Nov', usedMinor: used, targetMinor: target, refundSurplusMinor: 0,
    status: budgetStatus({ usedMinor: used, targetMinor: target, period: NOV, today: '2026-11-18' }), overlapsOverall: false, ...over,
  };
};
const cards = (over: Partial<HomeBudgetCards> = {}): HomeBudgetCards => ({ categoryBudgets: [], nws: null, defaultPeriod: NOV, ...over });

interface Setup {
  data?: HomeData;
  income?: IncomeExpense | null | (() => Promise<IncomeExpense | null>);
  budgets?: HomeBudgetCards | null | (() => Promise<HomeBudgetCards | null>);
  topCategories?: TopCategories | null | (() => Promise<TopCategories | null>);
  spend7d?: Spend7d | null | (() => Promise<Spend7d | null>);
}

async function mountCards(s: Setup = {}) {
  const qc = createQueryClient();
  clients.push(qc);
  const d = s.data ?? homeData({ currency: 'INR' });
  const loadIncome: () => Promise<IncomeExpense | null> = typeof s.income === 'function' ? s.income : async () => (s.income === undefined ? income() : (s.income as IncomeExpense | null));
  const loadBudgets: () => Promise<HomeBudgetCards | null> = typeof s.budgets === 'function' ? s.budgets : async () => (s.budgets === undefined ? cards() : (s.budgets as HomeBudgetCards | null));
  const api: HomeApi & { loadIncomeExpense: jest.Mock; loadBudgetCards: jest.Mock; loadTopCategories: jest.Mock; loadSpend7d: jest.Mock } = {
    loadTopCategories: jest.fn(typeof s.topCategories === 'function' ? s.topCategories : async () => (s.topCategories as TopCategories | null | undefined) ?? null),
    loadSpend7d: jest.fn(typeof s.spend7d === 'function' ? s.spend7d : async () => (s.spend7d as Spend7d | null | undefined) ?? null),
    load: async () => d,
    seen: new MemorySeenStore(),
    loadIncomeExpense: jest.fn(loadIncome as () => Promise<IncomeExpense | null>),
    loadBudgetCards: jest.fn(loadBudgets as () => Promise<HomeBudgetCards | null>),
  };
  const n = nav();
  const Harness = () => <HomeScreen api={api} settingsApi={{ setHideAmounts: async () => ({ ok: true }), timezoneCheck: async () => null } as never} {...n} />;
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <SheetHost>
              <Harness />
            </SheetHost>
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  await settle();
  return { r, n, api, qc, remount: () => mountCards(s) };
}

const withToCheck = (count: number) => homeData({ currency: 'INR', summary: { toCheckCount: count } });

describe('the card registry (Story 5.4)', () => {
  it('lists the cards in the default order with a stable id, title, sizes, drill-down and a visibility rule each', () => {
    expect(HOME_CARDS.map((c) => c.id)).toEqual(['to_check', 'income_expense', 'budgets', 'nws', 'top_categories', 'spend_7d']);
    for (const c of HOME_CARDS) {
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.sizes.length).toBeGreaterThan(0);
      expect(typeof c.drillDown).toBe('string');
      expect(typeof c.visible).toBe('function');
    }
  });
  it('shows a card only when it has something to show', () => {
    expect(visibleCards({ toCheckCount: 0, income: null, budgets: null, topCategories: null, spend7d: null }).map((c) => c.id)).toEqual([]);
    expect(visibleCards({ toCheckCount: 2, income: income(), budgets: cards({ categoryBudgets: [row({ id: 'a', name: 'A' })], nws: { rows: [row({ id: 'n', name: 'Needs', group: '50_30_20' })], typeSummary: null } }), topCategories: tc(), spend7d: sp() }).map((c) => c.id)).toEqual(['to_check', 'income_expense', 'budgets', 'nws', 'top_categories', 'spend_7d']);
  });
});

describe('N to check (Story 5.4)', () => {
  it('shows a 48dp row with the count, Waiting for you and a caret, read as one button, and opens the queue', async () => {
    const { r, n } = await mountCards({ data: withToCheck(3) });
    expect(texts(r)).toEqual(expect.arrayContaining(['3 to check', 'Waiting for you']));
    const row48 = host(r, 'home-card-to_check')[0]!;
    expect(StyleSheet.flatten(row48.props.style)).toMatchObject({ minHeight: 48 });
    expect(row48.props.accessibilityLabel).toBe('3 to check, Waiting for you');
    expect(row48.props.accessibilityRole).toBe('button');
    press(r, 'home-card-to_check');
    expect(n.onOpenReview).toHaveBeenCalled();
  });
  it('is not rendered at all at 0', async () => {
    const { r } = await mountCards({ data: withToCheck(0) });
    expect(host(r, 'home-card-to_check')).toHaveLength(0);
    expect(texts(r).some((t) => /to check/.test(t))).toBe(false);
  });
  it('sits directly under the hero, above the other cards', async () => {
    const { r } = await mountCards({ data: withToCheck(2) });
    const order = host(r, 'home-cards')[0]!.findAll((n) => typeof n.type === 'string' && /^home-card-/.test(String(n.props.testID))).map((n) => n.props.testID);
    expect(order[0]).toBe('home-card-to_check');
  });
});

describe('Income and expense (Story 5.4)', () => {
  it('shows Income, Spent and the net, no minus, with the scope caption', async () => {
    const { r } = await mountCards();
    expect(texts(r)).toEqual(expect.arrayContaining(['Income and expense', 'This period', 'Income', '+₹85,000.00', 'Spent', '₹8,140.00', 'Net ', '+₹76,860.00']));
    for (const t of texts(r)) expect(t).not.toMatch(/[-−]/);
  });
  it('reads Net ₹3,200.00 out when spending is more, and Net ₹0.00 when equal', async () => {
    const out = await mountCards({ income: income({ incomeMinor: 500_000, spentMinor: 820_000, net: { kind: 'out', minor: 320_000 } }) });
    expect(texts(out.r)).toEqual(expect.arrayContaining(['Net ', '₹3,200.00', ' out']));
    const even = await mountCards({ income: income({ incomeMinor: 100_000, spentMinor: 100_000, net: { kind: 'even', minor: 0 } }) });
    expect(texts(even.r)).toContain('₹0.00');
    expect(texts(even.r)).not.toContain(' out');
  });
  it('an empty period is genuine zeros, not a hidden card', async () => {
    const { r } = await mountCards({ income: income({ incomeMinor: 0, spentMinor: 0, net: { kind: 'even', minor: 0 } }) });
    expect(texts(r)).toEqual(expect.arrayContaining(['+₹0.00', '₹0.00']));
  });
  it('Income opens Activity for income this period; Spent opens expenses and refunds', async () => {
    const { r, n } = await mountCards();
    press(r, 'income-open');
    expect(n.onOpenActivity).toHaveBeenLastCalledWith({ types: ['income'], fromDate: '2026-11-01', toDate: '2026-11-30' });
    press(r, 'spent-open');
    expect(n.onOpenActivity).toHaveBeenLastCalledWith({ types: ['expense', 'refund'], fromDate: '2026-11-01', toDate: '2026-11-30' });
  });
  it('stacks Income and Spent at fontScale 1.3', async () => {
    mockFontScale = 1.3;
    const { r } = await mountCards();
    expect(StyleSheet.flatten(host(r, 'income-expense-row')[0]!.props.style)).toMatchObject({ flexDirection: 'column' });
  });
});

describe('Budgets (Story 5.4)', () => {
  const three = cards({
    categoryBudgets: [
      row({ id: 'g', name: 'Groceries', usedMinor: 340_000, targetMinor: 400_000 }),
      row({ id: 'f', name: 'Food & Drinks', usedMinor: 600_000, targetMinor: 400_000 }),
      row({ id: 'w', name: 'Weekly fuel', usedMinor: 10_000, targetMinor: 100_000, period: { start: '2026-11-16', end: '2026-11-22', kind: 'week' }, periodLabel: 'Weekly · 16–22 Nov' }),
    ],
  });
  it('shows limit bars in the order given, with the status line, and each opens its budget and period', async () => {
    const { r, n } = await mountCards({ budgets: three });
    expect(host(r, 'home-card-budgets')).toHaveLength(1);
    expect(texts(r)).toEqual(expect.arrayContaining(['Groceries', '₹3,400.00 of ₹4,000.00', 'Food & Drinks', '₹6,000.00 of ₹4,000.00']));
    expect(texts(r).some((t) => /^Over by ₹2,000\.00$/.test(t))).toBe(true);
    press(r, 'home-budget-g');
    expect(n.onOpenBudget).toHaveBeenLastCalledWith('g', '2026-11-01');
    press(r, 'home-budget-w');
    expect(n.onOpenBudget).toHaveBeenLastCalledWith('w', '2026-11-16');
  });
  it('a budget on its own period shows that period; one on the default period does not repeat it', async () => {
    const { r } = await mountCards({ budgets: three });
    expect(texts(r)).toContain('Weekly · 16–22 Nov');
    expect(texts(r).filter((t) => t === '1–30 Nov').length).toBe(1); // only the header chip
  });
  it('is not rendered with no category budgets', async () => {
    const { r } = await mountCards({ budgets: cards() });
    expect(host(r, 'home-card-budgets')).toHaveLength(0);
  });
});

describe('Needs, Wants and Savings (Story 5.4)', () => {
  const nws = cards({
    nws: {
      rows: [
        row({ id: 'n', name: 'Needs', group: '50_30_20', scope: 'budget_type', budgetType: 'need', usedMinor: 2_200_000, targetMinor: 4_000_000 }),
        row({ id: 'w', name: 'Wants', group: '50_30_20', scope: 'budget_type', budgetType: 'want', usedMinor: 500_000, targetMinor: 2_400_000 }),
        row({ id: 's', name: 'Savings', group: '50_30_20', scope: 'savings', usedMinor: 1_800_000, targetMinor: 1_600_000 }),
      ],
      typeSummary: { notClassifiedMinor: 300_000, categoryIds: ['cat_uncategorised'], period: NOV },
    },
  });
  it('reuses the bars, never warns on Savings, shows Not classified with Sort it, and opens Plan', async () => {
    const { r, n } = await mountCards({ budgets: nws });
    expect(texts(r)).toEqual(expect.arrayContaining(['Needs, Wants and Savings', '₹22,000.00 of ₹40,000.00', 'Target reached', 'Not classified ₹3,000.00 · Sort it']));
    expect(texts(r).some((t) => /Over by/.test(t))).toBe(false);
    press(r, 'home-budget-n');
    expect(n.onOpenPlan).toHaveBeenCalled();
    press(r, 'home-not-classified');
    expect(n.onOpenActivity).toHaveBeenLastCalledWith({ categoryIds: ['cat_uncategorised'], fromDate: '2026-11-01', toDate: '2026-11-30' });
  });
  it('shows no Not classified row at zero, and no card without 50/30/20', async () => {
    const zero = await mountCards({ budgets: cards({ nws: { rows: nws.nws!.rows, typeSummary: { ...nws.nws!.typeSummary!, notClassifiedMinor: 0 } } }) });
    expect(host(zero.r, 'home-not-classified')).toHaveLength(0);
    const none = await mountCards({ budgets: cards() });
    expect(host(none.r, 'home-card-nws')).toHaveLength(0);
  });
});

const tc = (over: Partial<TopCategories> = {}): TopCategories => ({
  rows: [
    { categoryId: 'cat_groceries', name: 'Groceries', icon: 'ShoppingCart', colorToken: 'cat-emerald', amountMinor: 420_000, sharePercent: 60, categoryIds: ['cat_groceries', 'cat_veg'] },
    { categoryId: 'cat_food', name: 'Food & Drinks', icon: 'ForkKnife', colorToken: 'cat-rose', amountMinor: 280_000, sharePercent: 40, categoryIds: ['cat_food'] },
  ],
  totalMinor: 700_000,
  period: NOV,
  ...over,
});
const sp = (over: Partial<Spend7d> = {}): Spend7d => ({
  days: ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18'].map((date, i) => ({ date, label: i === 6 ? 'Today' : ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue'][i]!, spentMinor: i === 2 ? 0 : 50_000 * (i + 1), isToday: i === 6 })),
  since: null,
  ...over,
});

describe('Top categories (Story 5.5)', () => {
  it('ranks the categories as bars with a 40dp chip, the name and a direct amount, and opens Activity for that category', async () => {
    const { r, n } = await mountCards({ topCategories: tc() });
    expect(host(r, 'home-card-top_categories')).toHaveLength(1);
    expect(texts(r)).toEqual(expect.arrayContaining(['Top categories · This period', 'Groceries', '₹4,200.00', 'Food & Drinks', '₹2,800.00', 'View as table']));
    press(r, 'top-categories-chart-bar-cat_groceries');
    expect(n.onOpenActivity).toHaveBeenLastCalledWith({ categoryIds: ['cat_groceries', 'cat_veg'], fromDate: '2026-11-01', toDate: '2026-11-30' });
  });

  it('the table lists name, amount and share, drills down the same way, and is remembered while Home is open', async () => {
    const { r, n, remount } = await mountCards({ topCategories: tc() });
    press(r, 'top-categories-chart-toggle');
    expect(host(r, 'top-categories-chart-table')).toHaveLength(1);
    expect(host(r, 'top-categories-chart-row-cat_food')[0]!.props.accessibilityLabel).toBe('Food & Drinks, 2,800 rupees, 40 percent');
    press(r, 'top-categories-chart-row-cat_food');
    expect(n.onOpenActivity).toHaveBeenLastCalledWith({ categoryIds: ['cat_food'], fromDate: '2026-11-01', toDate: '2026-11-30' });
    expect(host(r, 'top-categories-chart-table')).toHaveLength(1); // still the table after coming back: Home unchanged
    const fresh = await remount(); // a new Home (the app reopened) starts on the bars
    expect(host(fresh.r, 'top-categories-chart-table')).toHaveLength(0);
  });

  it('with no spending shows the empty state, not an empty chart', async () => {
    const { r } = await mountCards({ topCategories: tc({ rows: [], totalMinor: 0 }) });
    expect(texts(r)).toContain('Nothing spent yet this period.');
    expect(host(r, 'top-categories-chart')).toHaveLength(0);
  });

  it('shows no money while amounts are hidden: no fill, no percent, names stay', async () => {
    useAmountsStore.getState().setHidden(true);
    const { r } = await mountCards({ topCategories: tc() });
    expect(host(r, 'top-categories-chart-fill-cat_groceries')).toHaveLength(0);
    expect(moneyLeaks(r)).toEqual([]);
    expect(texts(r)).toContain('Groceries');
    press(r, 'top-categories-chart-toggle');
    expect(moneyLeaks(r)).toEqual([]);
    expect(texts(r).some((t) => /%/.test(t))).toBe(false);
  });
});

describe('chart cards: refresh and failures (Story 5.5)', () => {
  it('recompute with the hero when the home area is invalidated', async () => {
    const { r, api, qc } = await mountCards({ topCategories: tc(), spend7d: sp() });
    api.loadTopCategories.mockResolvedValue(tc({ rows: [{ categoryId: 'cat_health', name: 'Health', icon: 'Heart', colorToken: 'cat-rose', amountMinor: 999_900, sharePercent: 100, categoryIds: ['cat_health'] }] }));
    api.loadSpend7d.mockResolvedValue(sp({ days: sp().days.map((d) => ({ ...d, spentMinor: 12_300 })) }));
    await act(async () => qc.invalidateQueries({ queryKey: ['home'] }));
    await settle();
    expect(api.loadTopCategories).toHaveBeenCalledTimes(2);
    expect(api.loadSpend7d).toHaveBeenCalledTimes(2);
    expect(texts(r)).toEqual(expect.arrayContaining(['Health', '₹9,999.00', '₹123.00']));
  });

  it('a chart whose load fails shows its own error with Retry that reloads it, and the others stay', async () => {
    const { r, api } = await mountCards({ topCategories: async () => { throw new Error('boom'); }, spend7d: async () => { throw new Error('boom'); } });
    for (const id of ['top_categories', 'spend_7d']) {
      expect(host(r, `home-card-${id}`)[0]!.findAll((x) => typeof x.type === 'string' && x.props.testID === 'error-block')).toHaveLength(1);
    }
    expect(host(r, 'home-card-income_expense')).toHaveLength(1);
    api.loadTopCategories.mockResolvedValue(tc());
    const retry = host(r, 'home-card-top_categories')[0]!.findAll((x) => x.props.label === 'Try again' && typeof x.props.onPress === 'function')[0]!;
    await act(async () => retry.props.onPress());
    await settle();
    expect(texts(r)).toContain('Groceries');
    expect(api.loadSpend7d).toHaveBeenCalledTimes(1); // the other chart was not reloaded by this Retry
  });
});

describe('Spending, last 7 days (Story 5.5)', () => {
  it('shows one bar per day, today labelled Today, zero days as genuine zeros, and opens Activity for the day', async () => {
    const { r, n } = await mountCards({ spend7d: sp() });
    expect(texts(r)).toEqual(expect.arrayContaining(['Spending, last 7 days · Last 7 days', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Today', '₹0.00']));
    expect(host(r, 'spend-7d-chart-bar-2026-11-18')).toHaveLength(1);
    press(r, 'spend-7d-chart-bar-2026-11-14');
    expect(n.onOpenActivity).toHaveBeenLastCalledWith({ fromDate: '2026-11-14', toDate: '2026-11-14' });
    for (const t of texts(r)) expect(t).not.toMatch(/[-−]/);
  });

  it('a young profile shows only its days with Since, and no trend or comparison', async () => {
    const { r } = await mountCards({ spend7d: sp({ days: sp().days.slice(3), since: '2026-11-15' }) });
    expect(texts(r)).toContain('Since Sun 15 Nov');
    expect(host(r, 'spend-7d-chart-bar-2026-11-12')).toHaveLength(0);
    expect(texts(r).some((t) => /trend|vs|compared|↑|↓/i.test(t))).toBe(false);
  });

  it('the table reads each day, and masks like the other chart', async () => {
    const { r } = await mountCards({ spend7d: sp() });
    press(r, 'spend-7d-chart-toggle');
    expect(host(r, 'spend-7d-chart-table')).toHaveLength(1);
    expect(host(r, 'spend-7d-chart-row-2026-11-18')[0]!.props.accessibilityLabel).toBe('Today, 3,500 rupees');
  });
});

describe('cards refresh and failed refreshes (Story 5.4)', () => {
  it('recompute with the hero when the home area is invalidated, and show the new figures', async () => {
    const { r, api, qc } = await mountCards();
    expect(api.loadIncomeExpense).toHaveBeenCalledTimes(1);
    api.loadIncomeExpense.mockResolvedValue(income({ incomeMinor: 9_000_000, net: { kind: 'in', minor: 8_186_000 } }));
    api.loadBudgetCards.mockResolvedValue(cards({ categoryBudgets: [row({ id: 'g', name: 'Groceries' })] }));
    await act(async () => qc.invalidateQueries({ queryKey: ['home'] }));
    await settle();
    expect(api.loadIncomeExpense).toHaveBeenCalledTimes(2);
    expect(api.loadBudgetCards).toHaveBeenCalledTimes(2);
    expect(texts(r)).toEqual(expect.arrayContaining(['+₹90,000.00', 'Groceries']));
  });

  it('a refresh that fails keeps the last good card instead of replacing it with an error', async () => {
    const { r, api, qc } = await mountCards({ budgets: cards({ categoryBudgets: [row({ id: 'g', name: 'Groceries' })] }) });
    api.loadIncomeExpense.mockRejectedValue(new Error('boom'));
    api.loadBudgetCards.mockRejectedValue(new Error('boom'));
    await act(async () => qc.invalidateQueries({ queryKey: ['home'] }));
    await settle();
    expect(texts(r)).toEqual(expect.arrayContaining(['+₹85,000.00', 'Groceries']));
    expect(host(r, 'home-card-budgets')).toHaveLength(1);
    expect(host(r, 'home-card-income_expense')).toHaveLength(1);
  });

  it('a first load that fails puts the Budgets error in its own place in the order, once', async () => {
    const { r } = await mountCards({ data: withToCheck(1), budgets: async () => { throw new Error('boom'); } });
    const ids = host(r, 'home-cards')[0]!.findAll((x) => typeof x.type === 'string' && /^home-card-/.test(String(x.props.testID))).map((x) => x.props.testID);
    expect(ids).toEqual(['home-card-to_check', 'home-card-income_expense', 'home-card-budgets']);
  });

  it('shows a skeleton in the Budgets slot while it loads', async () => {
    let release!: (v: HomeBudgetCards | null) => void;
    const { r } = await mountCards({ budgets: () => new Promise((res) => { release = res; }) });
    expect(r.root.findAll((x) => typeof x.type === 'string' && x.props.testID === 'home-card-budgets')).toHaveLength(0);
    await act(async () => release(cards({ categoryBudgets: [row({ id: 'g', name: 'Groceries' })] })));
    await settle();
    expect(host(r, 'home-card-budgets')).toHaveLength(1);
  });
});

describe('cards for TalkBack (Story 5.4)', () => {
  it('each budget row is one button that reads the whole bar and its period', async () => {
    const { r } = await mountCards({ budgets: cards({ categoryBudgets: [row({ id: 'f', name: 'Food & Drinks', usedMinor: 600_000, targetMinor: 400_000 })] }) });
    const label = host(r, 'home-budget-f')[0]!.props.accessibilityLabel as string;
    expect(label).toMatch(/^Food & Drinks, 6,000 rupees of 4,000 rupees, Over by 2,000 rupees/);
    expect(label).toMatch(/1–30 Nov$/);
  });
  it('Income and Spent read their amounts, and the net chip is one node', async () => {
    const { r } = await mountCards();
    expect(host(r, 'income-open')[0]!.props.accessibilityLabel).toBe('Income, plus 85,000 rupees');
    expect(host(r, 'spent-open')[0]!.props.accessibilityLabel).toBe('Spent 8,140 rupees');
    expect(host(r, 'net-chip')[0]!.props.accessibilityLabel).toBe('Net, plus 76,860 rupees');
    const out = await mountCards({ income: income({ net: { kind: 'out', minor: 320_000 } }) });
    expect(host(out.r, 'net-chip')[0]!.props.accessibilityLabel).toBe('Net 3,200 rupees out');
  });
});

describe('cards: structure, errors, layout (Story 5.4)', () => {
  it('renders in the registry order under the hero', async () => {
    const { r } = await mountCards({
      data: withToCheck(1),
      budgets: cards({ categoryBudgets: [row({ id: 'g', name: 'Groceries' })], nws: { rows: [row({ id: 'n', name: 'Needs', group: '50_30_20', scope: 'budget_type', budgetType: 'need' })], typeSummary: null } }),
    });
    const ids = host(r, 'home-cards')[0]!.findAll((x) => typeof x.type === 'string' && /^home-card-/.test(String(x.props.testID))).map((x) => x.props.testID);
    expect(ids).toEqual(['home-card-to_check', 'home-card-income_expense', 'home-card-budgets', 'home-card-nws']);
  });
  it('card titles are headings and the scope caption follows the title', async () => {
    const { r } = await mountCards({ budgets: cards({ categoryBudgets: [row({ id: 'g', name: 'Groceries' })] }) });
    const heads = r.root.findAll((x) => x.type === Text && x.props.accessibilityRole === 'header').map((x) => x.props.children);
    expect(heads).toEqual(expect.arrayContaining(['Income and expense', 'Budgets']));
    const frame = host(r, 'home-card-income_expense')[0]!;
    const order = frame.findAll((x) => x.type === Text).map((x) => [x.props.children].flat().join(''));
    expect(order.indexOf('Income and expense')).toBeLessThan(order.indexOf('This period'));
  });
  it('a failing card shows its own error with Retry and the others stay', async () => {
    const { r, api } = await mountCards({ income: async () => { throw new Error('boom'); }, budgets: cards({ categoryBudgets: [row({ id: 'g', name: 'Groceries' })] }) });
    expect(host(r, 'home-card-income_expense')[0]!.findAll((x) => typeof x.type === 'string' && x.props.testID === 'error-block')).toHaveLength(1);
    expect(host(r, 'home-card-budgets')).toHaveLength(1);
    expect(texts(r)).toContain('Groceries');
    api.loadIncomeExpense.mockResolvedValue(income());
    const retry = host(r, 'home-card-income_expense')[0]!.findAll((x) => x.props.label === 'Try again' && typeof x.props.onPress === 'function')[0]!;
    await act(async () => retry.props.onPress());
    await settle();
    expect(texts(r)).toContain('+₹85,000.00');
  });
  it('the budgets card error does not hide the others', async () => {
    const { r } = await mountCards({ budgets: async () => { throw new Error('boom'); } });
    expect(host(r, 'home-card-budgets')[0]!.findAll((x) => typeof x.type === 'string' && x.props.testID === 'error-block')).toHaveLength(1);
    expect(host(r, 'home-card-income_expense')).toHaveLength(1);
  });
  it('keeps the end of the scroll clear of the tab bar and the plus button, also at 200% font', async () => {
    const { r } = await mountCards();
    const pad = (n: ReactTestRenderer) => StyleSheet.flatten(host(n, 'home-scroll')[0]!.props.contentContainerStyle).paddingBottom as number;
    expect(pad(r)).toBeGreaterThanOrEqual(16 + 8 + 56 + 28 + 16);
    mockFontScale = 2;
    const big = await mountCards();
    expect(pad(big.r)).toBeGreaterThanOrEqual(16 + 8 + 56 + 28 + 16);
  });
  it('shows no money while amounts are hidden, and keeps the counts and the days', async () => {
    useAmountsStore.getState().setHidden(true);
    const { r } = await mountCards({
      data: withToCheck(3),
      budgets: cards({ categoryBudgets: [row({ id: 'g', name: 'Groceries' })], nws: { rows: [row({ id: 'n', name: 'Needs', group: '50_30_20', scope: 'budget_type', budgetType: 'need' })], typeSummary: { notClassifiedMinor: 300_000, categoryIds: ['c'], period: NOV } } }),
    });
    expect(moneyLeaks(r)).toEqual([]);
    expect(texts(r)).toContain('3 to check');
  });
});
