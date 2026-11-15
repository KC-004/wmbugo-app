import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, type ComingUp, type GoalRow, type HomeLayoutEntry, type SavingsGoalCard, type TimelineItem } from '@wmbugo/core';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { MemorySeenStore } from '../../shared/feedback/tooltipController';
import { createQueryClient } from '../../shared/queryClient';
import { useAmountsStore } from '../../shared/state/amountsHidden';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { visibleCards } from './cardRegistry';
import { HomeScreen } from './HomeScreen';
import type { HomeApi } from './homeApi';
import { homeData } from './homeTestKit';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Kolkata' } }));

const live: ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => new Promise((res) => setTimeout(res, 0)));
  for (const r of live.splice(0)) act(() => r.unmount());
  jest.restoreAllMocks();
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
const has = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id).length > 0;
const press = (r: ReactTestRenderer, id: string) => act(() => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());

const item = (over: Partial<TimelineItem> = {}): TimelineItem => ({
  ruleId: 'r1', title: 'Rent', kind: 'rent', dueDate: '2026-11-20', status: 'upcoming', daysUntilDue: null, expectedAmountMinor: 1_800_000, accountName: 'HDFC', categoryIcon: 'House', categoryColor: 'cat-brown',
  cadence: 'monthly', customEvery: null, customUnit: null, paidBy: null, paidOn: null, ...over,
});
const goal = (over: Partial<GoalRow> = {}): GoalRow => ({
  id: 'g1', name: 'Goa trip', targetMinor: 3_000_000, dueDate: '2027-03-01', icon: 'Airplane', color: 'cat-cyan', accountId: null, accountName: null, state: 'active', setAsideMinor: 500_000, movedMinor: 0,
  contributedMinor: 500_000, remainingMinor: 2_500_000, funded: false, accountIsPot: false, progress: null, ...over,
});

interface Setup {
  comingUp?: ComingUp | null;
  savingsGoal?: SavingsGoalCard | null;
  layout?: HomeLayoutEntry[] | null;
}

async function mountHome(s: Setup = {}) {
  const qc = createQueryClient();
  const api: HomeApi = {
    load: async () => homeData({ currency: 'INR' }),
    seen: new MemorySeenStore(),
    loadIncomeExpense: async () => null,
    loadBudgetCards: async () => null,
    loadTopCategories: async () => null,
    loadSpend7d: async () => null,
    loadComingUp: async () => s.comingUp ?? null,
    loadSavingsGoal: async () => s.savingsGoal ?? null,
  };
  const n = { onAccounts: jest.fn(), onProfile: jest.fn(), onAddAccount: jest.fn(), onOpenBudget: jest.fn(), onOpenPlan: jest.fn(), onSetLimit: jest.fn(), onSortIt: jest.fn(), onOpenReview: jest.fn(), onOpenActivity: jest.fn(), onEditHome: jest.fn(), onOpenBill: jest.fn(), onOpenGoal: jest.fn(), onOpenGoals: jest.fn() };
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <SheetHost>
              <HomeScreen api={api} settingsApi={{ setHideAmounts: async () => ({ ok: true }), timezoneCheck: async () => null, load: async () => ({ settings: { ...DEFAULT_SETTINGS, homeLayout: s.layout ?? null } }) } as never} {...n} />
            </SheetHost>
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  await settle();
  return { r, n };
}

describe('the card registry (Story 6.10)', () => {
  it('registers Coming up and Savings goal after the 7-day spend, each shown only with its data', () => {
    const base = { toCheckCount: 0, income: null, budgets: null, topCategories: null, spend7d: null };
    expect(visibleCards({ ...base }).map((c) => c.id)).toEqual([]);
    const c: ComingUp = { today: '2026-11-12', payCycle: true, items: [], moreCount: 0 };
    expect(visibleCards({ ...base, comingUp: c, savingsGoal: { goal: goal(), moreCount: 0 } }).map((x) => x.id)).toEqual(['coming_up', 'savings_goal']);
    expect(visibleCards({ ...base, comingUp: null, savingsGoal: null }).map((x) => x.id)).toEqual([]);
  });
});

describe('Coming up (Story 6.10)', () => {
  const three = (): ComingUp => ({ today: '2026-11-12', payCycle: true, items: [item({ dueDate: '2026-11-12', status: 'due_soon', daysUntilDue: 0 }), item({ ruleId: 'r2', title: 'Phone', dueDate: '2026-11-14', status: 'due_soon', daysUntilDue: 2, expectedAmountMinor: 59_900 }), item({ ruleId: 'r3', title: 'Gym', dueDate: '2026-11-28' })], moreCount: 2 });

  it('shows up to three unpaid bills with their date, amount and status, the scope Before payday, and +2 more', async () => {
    const { r, n } = await mountHome({ comingUp: three() });
    const tx = texts(r);
    expect(tx).toEqual(expect.arrayContaining(['Coming up', 'Before payday', 'Rent · 12 Nov', 'Phone · 14 Nov', 'Gym · 28 Nov', 'Due today', 'Due in 2 days', 'Due 28 Nov', '+2 more']));
    expect(tx.some((t) => /^₹18,000(\.00)?$/.test(t))).toBe(true);
    await press(r, 'coming-up-r2-2026-11-14');
    expect(n.onOpenBill).toHaveBeenCalledWith('r2');
    await press(r, 'coming-up-more');
    expect(n.onOpenPlan).toHaveBeenCalled();
  });

  it('reads Nothing due before payday when nothing falls due, and is not there without a bill', async () => {
    const none = await mountHome({ comingUp: { today: '2026-11-12', payCycle: true, items: [], moreCount: 0 } });
    expect(texts(none.r)).toContain('Nothing due before payday');
    const off = await mountHome({ comingUp: { today: '2026-11-12', payCycle: false, items: [], moreCount: 0 } });
    expect(texts(off.r)).toEqual(expect.arrayContaining(['Before month-end', 'Nothing due before month-end']));
    const missing = await mountHome({ comingUp: null });
    expect(has(missing.r, 'home-card-coming_up')).toBe(false);
  });

  it('hidden amounts mask the amounts while the dates and statuses stay, and each row is one node', async () => {
    useAmountsStore.getState().setHidden(true);
    const { r } = await mountHome({ comingUp: three() });
    expect(texts(r).join(' ')).not.toMatch(/18,000|59,900/);
    expect(texts(r)).toEqual(expect.arrayContaining(['Rent · 12 Nov', 'Due today']));
    const row = r.root.findAll((x) => x.props.testID === 'coming-up-r1-2026-11-12')[0]!;
    expect(row.props.accessibilityLabel).not.toMatch(/18,000|eighteen/i);
    expect(row.props.accessibilityLabel).toMatch(/Rent, 12 Nov, .*Due today/);
  });

  it('never shows Free to use', async () => {
    const { r } = await mountHome({ comingUp: three(), savingsGoal: { goal: goal(), moreCount: 0 } });
    expect(texts(r).join(' ')).not.toMatch(/Free to use/);
  });
});

describe('Savings goal (Story 6.10)', () => {
  it('shows the goal with its bar, what is done and what is left, and +1 more goal', async () => {
    const { r, n } = await mountHome({ savingsGoal: { goal: goal(), moreCount: 1 } });
    expect(texts(r)).toEqual(expect.arrayContaining(['Savings goal', 'Goa trip', '+1 more goal']));
    expect(texts(r).some((t) => /^₹5,000(\.00)? of ₹30,000(\.00)?$/.test(t))).toBe(true);
    expect(texts(r).some((t) => /^₹25,000(\.00)? to go/.test(t))).toBe(true);
    expect(has(r, 'goal-bar-g1')).toBe(true);
    await press(r, 'goal-card-g1');
    expect(n.onOpenGoal).toHaveBeenCalledWith('g1');
    await press(r, 'savings-goal-more');
    expect(n.onOpenGoals).toHaveBeenCalled();
  });

  it('says +3 more goals, is absent without an active goal, and masks the bar when amounts are hidden', async () => {
    const many = await mountHome({ savingsGoal: { goal: goal(), moreCount: 3 } });
    expect(texts(many.r)).toContain('+3 more goals');
    const none = await mountHome({ savingsGoal: null });
    expect(has(none.r, 'home-card-savings_goal')).toBe(false);
    useAmountsStore.getState().setHidden(true);
    const hidden = await mountHome({ savingsGoal: { goal: goal(), moreCount: 0 } });
    expect(has(hidden.r, 'goal-bar-g1')).toBe(false);
    expect(texts(hidden.r).join(' ')).not.toMatch(/5,000|30,000|25,000/);
  });

  it('Edit Home can hide it: a layout with Savings goal hidden leaves it off Home', async () => {
    const entries: HomeLayoutEntry[] = [{ cardId: 'savings_goal', hidden: true, size: 'full' }];
    const { r } = await mountHome({ savingsGoal: { goal: goal(), moreCount: 0 }, layout: entries });
    expect(has(r, 'home-card-savings_goal')).toBe(false);
  });
});
