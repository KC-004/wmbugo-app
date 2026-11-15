import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { budgetStatus, mapCategoryRows, type FreeToUse, SEED_CATEGORIES, type BudgetListRow, type GoalRow, type PlanTimeline, type TimelineItem } from '@wmbugo/core';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { useUiStore } from '../../shared/state/uiStore';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import type { BillOutcome, BillsApi, BillsData } from '../bills/billsApi';
import type { BudgetsApi, BudgetsData } from '../budgets/budgetsApi';
import { NO_TEMPLATE } from '../budgets/budgetsTestKit';
import type { GoalOutcome, GoalsApi, GoalsData } from '../goals/goalsApi';
import { leadLabel, PlanHubScreen, timelineAsRow } from './PlanHubScreen';
import type { PlanApi } from './planApi';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0 } }));

const live: ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => new Promise((res) => setTimeout(res, 0)));
  for (const r of live.splice(0)) act(() => r.unmount());
  jest.restoreAllMocks();
  useUiStore.setState({ pendingBudgetEditor: false } as never);
});
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
  jest.spyOn(AccessibilityInfo, 'getRecommendedTimeoutMillis').mockImplementation(async (ms: number) => ms);
});

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => new Promise((res) => setTimeout(res, 0)));
};
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
const has = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id).length > 0;
const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());
  await settle();
};
const mountNode = async (node: React.ReactElement) => {
  const qc = createQueryClient();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <SheetHost>{node}</SheetHost>
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  await settle();
  return r;
};

const item = (over: Partial<TimelineItem> = {}): TimelineItem => ({
  ruleId: 'r1', title: 'Rent', kind: 'rent', dueDate: '2026-11-20', status: 'upcoming', daysUntilDue: null, expectedAmountMinor: 1_800_000, accountName: 'HDFC', categoryIcon: 'House', categoryColor: 'cat-brown',
  cadence: 'monthly', customEvery: null, customUnit: null, paidBy: null, paidOn: null, ...over,
});
const timeline = (over: Partial<PlanTimeline> = {}): PlanTimeline => ({
  today: '2026-11-12', period: { start: '2026-11-01', end: '2026-11-30', label: '1–30 Nov', daysLeft: 19, payCycle: true }, items: [item()], activeBills: 1, nextBill: { title: 'Rent', dueDate: '2026-11-20' }, ...over,
});

const planApi = (t: PlanTimeline | 'error' | null, free: FreeToUse | 'error' = { gate: 'needs_limit' }): PlanApi => ({
  loadFreeToUse: jest.fn(async () => {
    if (free === 'error') throw new Error('x');
    return { free, currency: 'INR' as const, locale: 'en-IN', payCycle: true };
  }),
  loadTimeline: jest.fn(async () => {
    if (t === 'error') throw new Error('x');
    return t ? { timeline: t, currency: 'INR' as const, locale: 'en-IN' } : null;
  }),
});

const categories = mapCategoryRows(SEED_CATEGORIES.map((c, i) => [c.id, c.name, c.kind, c.budgetType, c.icon, c.color, i, null]));
const billsData = (total = 0): BillsData => ({
  list: { today: '2026-11-12', active: Array.from({ length: total }, (_, i) => ({ id: `b${i}` }) as never), paused: [], ended: [], subscriptions: { totalMinor: 0, counted: 0 } },
  currency: 'INR', locale: 'en-IN', exponent: 2, categories, accounts: [{ id: 'a1', name: 'HDFC' }], notificationsDenied: false,
});
const billsApi = (d: BillsData) => {
  const ok: BillOutcome = { ok: true };
  const api = {
    load: jest.fn(async () => d), loadDetail: jest.fn(async () => 'missing' as const),
    save: jest.fn(async () => ({ ok: true as const, value: { ruleId: 'new', created: true } })),
    remove: jest.fn(async () => ok), restore: jest.fn(async () => ok), pause: jest.fn(async () => ok), resume: jest.fn(async () => ok), end: jest.fn(async () => ok), markPaid: jest.fn(async () => ok), unmarkPaid: jest.fn(async () => ok),
    forEntry: jest.fn(async () => ({ link: null, match: null })), link: jest.fn(async () => ok), unlink: jest.fn(async () => ok), dismissMatch: jest.fn(async () => ok), candidates: jest.fn(async () => []),
  };
  return api as typeof api & BillsApi;
};

const goal = (over: Partial<GoalRow> = {}): GoalRow => ({
  id: 'g1', name: 'Goa trip', targetMinor: 3_000_000, dueDate: '2027-03-01', icon: 'Airplane', color: 'cat-cyan', accountId: null, accountName: null, state: 'active',
  setAsideMinor: 0, movedMinor: 0, contributedMinor: 0, remainingMinor: 3_000_000, funded: false, accountIsPot: false, progress: null, ...over,
});
const goalsData = (goals: GoalRow[] = []): GoalsData => ({ goals, currency: 'INR', locale: 'en-IN', exponent: 2, accounts: [], thisMonth: '2026-11' });
const goalsApi = (d: GoalsData | 'error') => {
  const ok: GoalOutcome = { ok: true };
  const api = {
    load: jest.fn(async () => {
      if (d === 'error') throw new Error('x');
      return d;
    }),
    loadDetail: jest.fn(async () => 'missing' as const), save: jest.fn(async () => ({ ok: true as const, value: { goalId: 'n', created: true } })), undoAdd: jest.fn(async () => ok),
    setAside: jest.fn(async () => ({ ok: true as const, value: { allocationId: 'a' } })), takeBack: jest.fn(async () => ({ ok: true as const, value: { allocationId: 'a' } })), undoAllocation: jest.fn(async () => ok), changeState: jest.fn(async () => ok),
    forTransfer: jest.fn(async () => ({ goal: null, canCount: false, goals: [] })), countToward: jest.fn(async () => ok), removeTag: jest.fn(async () => ok),
  };
  return api as typeof api & GoalsApi;
};

const NOV = { start: '2026-11-01', end: '2026-11-30' };
const budgetRow = (id: string, name: string, used: number, over: Partial<BudgetListRow> = {}): BudgetListRow => ({
  id, name, group: 'categories', scope: 'category', budgetType: null, period: { ...NOV, kind: 'calendar_month' }, periodLabel: '1–30 Nov', usedMinor: used, targetMinor: 600_000, refundSurplusMinor: 0,
  status: budgetStatus({ usedMinor: used, targetMinor: 600_000, period: NOV, today: '2026-11-12' }), overlapsOverall: false, ...over,
});
const budgetsApi = (rows: BudgetListRow[]): BudgetsApi => {
  const data: BudgetsData = { list: { today: '2026-11-12', rows, overallId: null, typeSummary: null }, currency: 'INR', locale: 'en-IN', exponent: 2, payCycle: true, categories, accounts: [{ id: 'a1', name: 'HDFC' }], template: NO_TEMPLATE };
  return { load: async () => data, readForEdit: async () => null, save: async () => ({ ok: false, code: 'X' }), undo: async () => ({ ok: true }), loadDetail: async () => null, remove: async () => ({ ok: true }), restore: async () => ({ ok: true }), createTemplate: async () => ({ ok: false, code: 'X' }), undoTemplate: async () => ({ ok: true }), changeTemplate: async () => ({ ok: true }), dismissTemplateCard: async () => undefined, answerIncomeChange: async () => ({ ok: true }) };
};

const nav = () => ({ onOpenAccounts: jest.fn(), onOpenBills: jest.fn(), onOpenBill: jest.fn(), onOpenGoals: jest.fn(), onOpenGoal: jest.fn(), onOpenBudgets: jest.fn(), onOpenBudget: jest.fn() });

describe('timeline helpers (Story 6.8)', () => {
  it('labels a due date Today, Tomorrow or by day and month', () => {
    expect(leadLabel('2026-11-12', '2026-11-12')).toBe('Today');
    expect(leadLabel('2026-11-13', '2026-11-12')).toBe('Tomorrow');
    expect(leadLabel('2026-12-05', '2026-11-12')).toBe('5 Dec');
  });

  it('maps an occurrence to the same status line a bill has', () => {
    expect(timelineAsRow(item({ status: 'due_soon', daysUntilDue: 2 })).status).toMatchObject({ kind: 'due_soon', daysUntilDue: 2 });
    expect(timelineAsRow(item({ status: 'paid', paidBy: 'linked', paidOn: '2026-11-04' })).status).toMatchObject({ kind: 'paid', paidBy: 'linked', paidOn: '2026-11-04' });
    expect(timelineAsRow(item({ status: 'not_seen_yet' })).status.kind).toBe('not_seen_yet');
  });
});

describe('Plan hub (Story 6.8)', () => {
  it('with nothing set up shows the three setup cards, and Add your rent opens the bill editor pre-filled', async () => {
    const bills = billsApi(billsData(0));
    const r = await mountNode(
      <PlanHubScreen plan={planApi(timeline({ items: [], activeBills: 0, nextBill: null }))} billsApi={bills} goalsApi={goalsApi(goalsData())} budgetsApi={budgetsApi([])} {...nav()} />,
    );
    expect(texts(r)).toEqual(expect.arrayContaining(['Add your rent', 'See it coming before payday.', 'Set one budget', 'One limit is enough to start.', 'Name a goal', 'Saving for something? Give it a name.']));
    await press(r, 'plan-setup-rent-action');
    expect(has(r, 'bill-sheet')).toBe(true);
    const name = r.root.findAll((n) => n.props.testID === 'bill-name' && typeof n.props.onChangeText === 'function')[0]!;
    expect(name.props.value).toBe('Rent');
  });

  it('the Set one budget card asks for the budget editor, and Name a goal opens the goal editor', async () => {
    const r = await mountNode(<PlanHubScreen plan={planApi(timeline({ items: [], activeBills: 0, nextBill: null }))} billsApi={billsApi(billsData(0))} goalsApi={goalsApi(goalsData())} budgetsApi={budgetsApi([])} {...nav()} />);
    await press(r, 'plan-setup-goal-action');
    expect(has(r, 'goal-sheet')).toBe(true);
    useUiStore.setState({ pendingBudgetEditor: false } as never);
    await press(r, 'plan-setup-budget-action');
    // The Budgets section is mounted, so it takes the request and opens the editor with Overall chosen.
    expect(has(r, 'budget-sheet')).toBe(true);
    expect(useUiStore.getState().pendingBudgetEditor).toBe(false);
  });

  it('shows Before payday with the period, the bills as rows with a date, and the footer line', async () => {
    const t = timeline({
      items: [item({ dueDate: '2026-11-12', status: 'due_soon', daysUntilDue: 0 }), item({ ruleId: 'r2', title: 'Phone', dueDate: '2026-11-13', status: 'due_soon', daysUntilDue: 1 }), item({ ruleId: 'r3', title: 'Gym', dueDate: '2026-11-28' })],
      activeBills: 3,
    });
    const onOpenBill = jest.fn();
    const r = await mountNode(<PlanHubScreen plan={planApi(t)} billsApi={billsApi(billsData(3))} goalsApi={goalsApi(goalsData([goal()]))} budgetsApi={budgetsApi([budgetRow('b1', 'Groceries', 300_000)])} {...nav()} onOpenBill={onOpenBill} />);
    const tx = texts(r);
    expect(tx).toEqual(expect.arrayContaining(['Before payday', '1–30 Nov · 19 days left', 'Today', 'Tomorrow', '28 Nov', 'Due today', 'Due tomorrow', 'Showing 3 bills you added. Missing EMIs or subscriptions?', 'Add them']));
    await press(r, 'bill-row-r1-2026-11-12');
    expect(onOpenBill).toHaveBeenCalledWith('r1');
    await press(r, 'plan-add-them');
    expect(has(r, 'bill-sheet')).toBe(true);
  });

  it('says Before month-end without a payday, one bill reads singular, and with bills but none due it says nothing is due', async () => {
    const t = timeline({ items: [], period: { start: '2026-11-01', end: '2026-11-30', label: '1–30 Nov', daysLeft: 1, payCycle: false } });
    const r = await mountNode(<PlanHubScreen plan={planApi(t)} billsApi={billsApi(billsData(1))} goalsApi={goalsApi(goalsData([goal()]))} budgetsApi={budgetsApi([budgetRow('b1', 'Groceries', 300_000)])} {...nav()} />);
    expect(texts(r)).toEqual(expect.arrayContaining(['Before month-end', '1–30 Nov · 1 day left', 'Nothing due before month-end', 'Showing 1 bill you added. Missing EMIs or subscriptions?']));
  });

  it('shows Budgets (up to three by percent used, See all), Bills & recurring and Goals (See all) and opens each', async () => {
    const n = nav();
    const rows = [budgetRow('b1', 'Low', 100_000), budgetRow('b2', 'High', 590_000), budgetRow('b3', 'Mid', 400_000), budgetRow('b4', 'Mid2', 300_000), budgetRow('b5', 'Zero', 0)];
    const t = timeline({ activeBills: 3, nextBill: { title: 'Rent', dueDate: '2026-12-05' } });
    const goals = [goal(), goal({ id: 'g2', name: 'Bike' }), goal({ id: 'g3', name: 'Phone fund' }), goal({ id: 'g4', name: 'Fourth' })];
    const r = await mountNode(<PlanHubScreen plan={planApi(t)} billsApi={billsApi(billsData(3))} goalsApi={goalsApi(goalsData(goals))} budgetsApi={budgetsApi(rows)} {...n} />);
    expect(has(r, 'budget-row-b2')).toBe(true);
    expect(has(r, 'budget-row-b3')).toBe(true);
    expect(has(r, 'budget-row-b4')).toBe(true);
    expect(has(r, 'budget-row-b1')).toBe(false);
    expect(has(r, 'budget-row-b5')).toBe(false);
    await press(r, 'budgets-see-all');
    expect(n.onOpenBudgets).toHaveBeenCalled();
    expect(texts(r)).toContain('3 bills · next: Rent on 5 Dec');
    await press(r, 'plan-open-bills');
    expect(n.onOpenBills).toHaveBeenCalled();
    expect(has(r, 'goal-card-g3')).toBe(true);
    expect(has(r, 'goal-card-g4')).toBe(false);
    await press(r, 'plan-see-all-goals');
    expect(n.onOpenGoals).toHaveBeenCalled();
    await press(r, 'goal-card-g1');
    expect(n.onOpenGoal).toHaveBeenCalledWith('g1');
  });

  it('a failing section shows its own error with Retry and the rest still render', async () => {
    const goals = goalsApi('error');
    const r = await mountNode(<PlanHubScreen plan={planApi(timeline())} billsApi={billsApi(billsData(1))} goalsApi={goals} budgetsApi={budgetsApi([budgetRow('b1', 'Groceries', 300_000)])} {...nav()} />);
    expect(has(r, 'plan-goals-error')).toBe(true);
    expect(texts(r)).toContain("Couldn't load this section");
    expect(has(r, 'bill-row-r1-2026-11-20')).toBe(true);
    expect(has(r, 'budget-row-b1')).toBe(true);
    const tl = await mountNode(<PlanHubScreen plan={planApi('error')} billsApi={billsApi(billsData(1))} goalsApi={goalsApi(goalsData([goal()]))} budgetsApi={budgetsApi([])} {...nav()} />);
    expect(has(tl, 'plan-timeline-error')).toBe(true);
    expect(has(tl, 'goal-card-g1')).toBe(true);
  });

  it('with bills but no budget or goal, only the missing ones show their setup cards', async () => {
    const r = await mountNode(<PlanHubScreen plan={planApi(timeline())} billsApi={billsApi(billsData(1))} goalsApi={goalsApi(goalsData())} budgetsApi={budgetsApi([])} {...nav()} />);
    expect(has(r, 'plan-setup-rent')).toBe(false);
    expect(has(r, 'plan-setup-upcoming')).toBe(false);
    expect(has(r, 'plan-setup-budget')).toBe(true);
    expect(has(r, 'plan-setup-goal')).toBe(true);
    const noBills = await mountNode(<PlanHubScreen plan={planApi(timeline({ items: [], activeBills: 0, nextBill: null }))} billsApi={billsApi(billsData(0))} goalsApi={goalsApi(goalsData([goal()]))} budgetsApi={budgetsApi([budgetRow('b1', 'G', 1)])} {...nav()} />);
    expect(texts(noBills)).toEqual(expect.arrayContaining(['Add upcoming bills', 'Rent, EMIs, subscriptions: see them before payday.']));
    expect(has(noBills, 'plan-setup-rent')).toBe(false);
  });

  it('hidden amounts mask the timeline rows while the dates stay', async () => {
    const { useAmountsStore } = jest.requireActual('../../shared/state/amountsHidden') as typeof import('../../shared/state/amountsHidden');
    act(() => useAmountsStore.setState({ hidden: true } as never));
    try {
      const r = await mountNode(<PlanHubScreen plan={planApi(timeline())} billsApi={billsApi(billsData(1))} goalsApi={goalsApi(goalsData())} budgetsApi={budgetsApi([budgetRow('b1', 'Groceries', 300_000)])} {...nav()} />);
      expect(texts(r).join(' ')).not.toMatch(/18,000/);
      expect(texts(r)).toContain('20 Nov');
      expect(r.root.findAll((n) => n.props.testID === 'bill-row-r1-2026-11-20')[0]!.props.accessibilityLabel).not.toMatch(/18,000|eighteen/i);
    } finally {
      act(() => useAmountsStore.setState({ hidden: false } as never));
    }
  });
});

describe('Free to use (Story 6.9)', () => {
  const ok = (over: Partial<Extract<FreeToUse, { gate: 'ok' }>> = {}): FreeToUse => ({
    gate: 'ok', valueMinor: 1_200_000, shortByMinor: 0, smaller: 'accounts', leavesMinor: 1_200_000, leftMinor: 1_800_000, leftBudgetId: 'b1', notClassifiedMinor: 0, assetsMinor: 4_200_000, notSetAccounts: 0,
    billsReservedMinor: 1_800_000, billsCount: 2, setAsideMinor: 1_200_000, ...over,
  });
  const hub = (free: FreeToUse | 'error', n = nav()) => mountNode(<PlanHubScreen plan={planApi(timeline(), free)} billsApi={billsApi(billsData(1))} goalsApi={goalsApi(goalsData([goal()]))} budgetsApi={budgetsApi([budgetRow('b1', 'Groceries', 300_000)])} {...n} />);

  it('shows the figure, the caption and one tappable tile above the timeline', async () => {
    const r = await hub(ok());
    expect(texts(r).some((t) => /^₹12,000(\.00)?$/.test(t))).toBe(true);
    expect(texts(r)).toEqual(expect.arrayContaining(['Free to use', 'Estimate from what you\'ve entered']));
    expect(r.root.findAll((n) => n.props.testID === 'free-tile')[0]!.props.accessibilityLabel).toMatch(/^Free to use, estimate, 12,000 rupees.* Double-tap to see how we worked this out$/);
  });

  it('a negative value reads Short by with no sign and no warning icon', async () => {
    const r = await hub(ok({ valueMinor: -500_000, shortByMinor: 500_000, leavesMinor: -500_000 }));
    expect(texts(r).some((t) => /^Short by ₹5,000(\.00)?$/.test(t))).toBe(true);
    expect(texts(r).join(' ')).not.toMatch(/-₹|−/);
    expect(r.root.findAll((n) => n.props.testID === 'free-tile')[0]!.props.accessibilityLabel).toMatch(/short by 5,000 rupees/);
  });

  it('without a limit one row names the one step, and Set a limit opens the budget editor', async () => {
    const r = await hub({ gate: 'needs_limit' });
    expect(texts(r)).toContain('Not enough information yet · Set a limit →');
    expect(has(r, 'free-tile')).toBe(false);
    await press(r, 'free-need-limit');
    expect(has(r, 'budget-sheet')).toBe(true);
  });

  it('with a limit but no account with a balance, the one step is Add an account', async () => {
    const n = nav();
    const r = await hub({ gate: 'needs_account', hasAccounts: false }, n);
    expect(texts(r)).toContain('Not enough information yet · Add an account →');
    await press(r, 'free-need-account');
    expect(n.onOpenAccounts).toHaveBeenCalled();
  });

  it('tapping the figure shows how it was worked out, marks the smaller side and opens each source', async () => {
    const n = nav();
    const r = await hub(ok({ notClassifiedMinor: 300_000, notSetAccounts: 1 }), n);
    await press(r, 'free-tile');
    const tx = texts(r);
    expect(tx).toEqual(expect.arrayContaining(['How we worked this out', 'We use the smaller', 'This is an estimate from what you\'ve entered, not a guarantee.', 'Accounts in your totals, not savings pots · +1 account not set']));
    expect(tx.some((t) => /^Left in budget ₹18,000(\.00)?$/.test(t))).toBe(true);
    expect(tx.some((t) => /^Bills before payday take ₹18,000(\.00)? \(2 bills\)$/.test(t))).toBe(true);
    expect(tx.some((t) => /^Set aside for goals takes ₹12,000(\.00)?$/.test(t))).toBe(true);
    expect(tx.some((t) => /^Leaves ₹12,000(\.00)?$/.test(t))).toBe(true);
    expect(tx.some((t) => /^Includes ₹3,000(\.00)? not classified$/.test(t))).toBe(true);
    expect(has(r, 'free-how-accounts-smaller')).toBe(true);
    expect(has(r, 'free-how-left-smaller')).toBe(false);
    await press(r, 'free-how-left');
    expect(n.onOpenBudget).toHaveBeenCalledWith('b1');
    await press(r, 'free-tile');
    await press(r, 'free-how-bills');
    expect(n.onOpenBills).toHaveBeenCalled();
    await press(r, 'free-tile');
    await press(r, 'free-how-aside');
    expect(n.onOpenGoals).toHaveBeenCalled();
  });

  it('hidden amounts mask the figure and the spoken label says amount hidden', async () => {
    const { useAmountsStore } = jest.requireActual('../../shared/state/amountsHidden') as typeof import('../../shared/state/amountsHidden');
    act(() => useAmountsStore.setState({ hidden: true } as never));
    try {
      const r = await hub(ok({ valueMinor: -500_000, shortByMinor: 500_000 }));
      expect(texts(r)).toContain('Short by ₹ ••••');
      expect(r.root.findAll((n) => n.props.testID === 'free-tile')[0]!.props.accessibilityLabel).toBe('Free to use, estimate, amount hidden. Double-tap to see how we worked this out');
    } finally {
      act(() => useAmountsStore.setState({ hidden: false } as never));
    }
  });

  it('never appears on Home: the tile belongs to Plan only', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const homeDir = path.join(__dirname, '..', 'home');
    for (const f of fs.readdirSync(homeDir).filter((n: string) => /\.tsx?$/.test(n) && !/test/.test(n))) {
      expect(fs.readFileSync(path.join(homeDir, f), 'utf8')).not.toMatch(/FreeToUse|Free to use/);
    }
  });
});
