import { budgetStatus, type BudgetListRow, type GoalRow, type NwsView } from '@wmbugo/core';
import { useAmountsStore } from '../../../shared/state/amountsHidden';
import type { OnTrackData } from '../insightsApi';
import { InsightsScreen } from '../InsightsScreen';
import { fakeInsightsApi, has, installInsightsHooks, mountNode, overview, press, texts } from '../insightsTestKit';
import { useInsightsStore } from '../insightsStore';
import { registerInsightsSection } from '../sectionRegistry';
import { amIOnTrack } from './AmIOnTrack';

jest.mock('../../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Kolkata' } }));
installInsightsHooks();

const echo = { start: '2026-11-01', end: '2026-11-30', endExclusive: '2026-12-01', label: '1–30 Nov', filters: {} };
const row = (id: string, name: string, used: number, target: number, over: Partial<BudgetListRow> = {}): BudgetListRow => ({
  id, name, group: 'categories', scope: 'category', budgetType: null, period: { start: '2026-11-01', end: '2026-11-30', kind: 'pay_cycle' }, periodLabel: '1–30 Nov', usedMinor: used, targetMinor: target, refundSurplusMinor: 0,
  status: budgetStatus({ usedMinor: used, targetMinor: target, period: { start: '2026-11-01', end: '2026-11-30' }, today: '2026-11-08' }), overlapsOverall: false, ...over,
});
const goal = (over: Partial<GoalRow> = {}): GoalRow => ({ id: 'g1', name: 'Goa trip', targetMinor: 3_000_000, dueDate: '2027-03-01', icon: 'Airplane', color: 'cat-cyan', accountId: null, accountName: null, state: 'active', setAsideMinor: 500_000, movedMinor: 0, contributedMinor: 500_000, remainingMinor: 2_500_000, funded: false, accountIsPot: false, progress: null, ...over });

const track = (over: Partial<OnTrackData['track']> = {}): OnTrackData => ({
  currency: 'INR',
  locale: 'en-IN',
  thisMonth: '2026-11',
  track: { scope: echo, budgetsState: 'ok', budgets: [row('o', 'Overall', 1_230_000, 5_000_000, { group: 'overall', scope: 'overall' }), row('f', 'Food', 850_000, 1_000_000, { overlapsOverall: true })], nws: null, goals: [goal()], ...over },
});
const nws = (over: Partial<NwsView> = {}): NwsView => ({ amounts: { needsMinor: 2_200_000, wantsMinor: 900_000, savingsMinor: 0, notClassifiedMinor: 300_000 }, needs: null, wants: null, savings: null, notClassifiedCategoryIds: ['cat_other'], period: { start: '2026-11-01', end: '2026-11-30' }, ...over });

const screen = (d: OnTrackData | null | 'error', nav: Record<string, jest.Mock> = {}, ov = overview()) => {
  registerInsightsSection(amIOnTrack);
  const api = fakeInsightsApi({
    loadOverview: jest.fn(async () => ov),
    loadOnTrack: jest.fn(async () => {
      if (d === 'error') throw new Error('x');
      return d;
    }),
  });
  return <InsightsScreen api={api} nav={nav} />;
};

describe('Am I on track? (Story 7.7)', () => {
  it('is a heading, and the Budgets card lists the overall budget first with its limit bar and the percent used', async () => {
    const r = await mountNode(screen(track()));
    const t = texts(r);
    expect(t).toContain('Am I on track?');
    expect(t).toContain('Budgets');
    expect(t.indexOf('Overall')).toBeLessThan(t.indexOf('Food'));
    expect(t).toContain('85% used');
    expect(has(r, 'budgets-limit-f')).toBe(true);
    expect(t).toContain('Also counted in your overall budget');
  });

  it('a refund surplus shows Refunds this period: +₹7,000, and nothing carries a minus sign', async () => {
    const d = track({ budgets: [row('s', 'Shopping', 0, 1_000_000, { refundSurplusMinor: 700_000 })] });
    const r = await mountNode(screen(d));
    expect(texts(r).some((x) => /^Refunds this period: \+₹7,000(\.00)?$/.test(x))).toBe(true);
    expect(texts(r).join(' ')).not.toMatch(/[-−]\s?₹|[-−]\d/);
  });

  it('a row opens that budget for its period', async () => {
    const onOpenBudget = jest.fn();
    const r = await mountNode(screen(track(), { onOpenBudget }));
    await press(r, 'budgets-row-f');
    expect(onOpenBudget).toHaveBeenCalledWith('f', '2026-11-01');
  });

  it('with no budgets the card is not drawn; for a period that is not a budget period it says so and offers This pay cycle', async () => {
    const none = await mountNode(screen(track({ budgets: [] })));
    expect(has(none, 'budgets-card')).toBe(false);
    const seven = await mountNode(screen(track({ budgetsState: 'not_budget_period', budgets: [], nws: null })));
    expect(texts(seven)).toContain('Budgets are shown for whole pay cycles or months. Pick one to see them.');
    await press(seven, 'budgets-pick-period');
    expect(useInsightsStore.getState().selection.preset).toBe('default');
  });

  it('filters add the caption that budgets use their own categories and accounts', async () => {
    const ov = overview({ filterChips: [{ key: 'accountIds', value: 'a1', label: 'HDFC' }] });
    const r = await mountNode(screen(track({ nws: nws() }), {}, ov));
    expect(texts(r)).toContain('Budgets use their own categories and accounts');
    expect(texts(r)).toContain('Targets use their own categories and accounts');
    expect(texts(r)).toContain('Goals are not limited by these filters');
  });

  it('View as table lists each budget with used, target and status in words, and no minus sign', async () => {
    const r = await mountNode(screen(track({ budgets: [row('f', 'Food', 1_100_000, 1_000_000)] })));
    await press(r, 'budgets-toggle');
    expect(has(r, 'budgets-table')).toBe(true);
    expect(texts(r).some((x) => /Over by ₹1,000/.test(x))).toBe(true);
    expect(texts(r).join(' ')).not.toMatch(/[-−]\s?₹/);
  });
});

describe('Needs, Wants, Savings card (Story 7.7)', () => {
  it('without targets it shows the three amounts, Not classified with Sort it, and No targets set', async () => {
    const onSortIt = jest.fn();
    const onTryTemplate = jest.fn();
    const r = await mountNode(screen(track({ nws: nws() }), { onSortIt, onTryTemplate }));
    const t = texts(r);
    expect(t).toContain('Needs, Wants, Savings');
    expect(t).toContain('No targets set · Try 50/30/20');
    await press(r, 'nws-sort');
    expect(onSortIt).toHaveBeenCalledWith({ categoryIds: ['cat_other'], fromDate: '2026-11-01', toDate: '2026-11-30' });
    await press(r, 'nws-try');
    expect(onTryTemplate).toHaveBeenCalled();
  });

  it('with targets it draws the three bars in their own tones and never an Over by for Savings', async () => {
    const needs = row('n', 'Needs', 2_200_000, 5_000_000, { group: '50_30_20', scope: 'budget_type', budgetType: 'need' });
    const wants = row('w', 'Wants', 900_000, 3_000_000, { group: '50_30_20', scope: 'budget_type', budgetType: 'want' });
    const savings = row('s', 'Savings', 2_500_000, 2_000_000, { group: '50_30_20', scope: 'savings' });
    const r = await mountNode(screen(track({ nws: nws({ needs, wants, savings }) })));
    expect(has(r, 'nws-limit-needs')).toBe(true);
    expect(has(r, 'nws-limit-wants')).toBe(true);
    expect(has(r, 'nws-limit-savings')).toBe(true);
    expect(texts(r)).toContain('Target reached');
    expect(texts(r).join(' ')).not.toMatch(/Over by ₹5/);
  });

  it('is not drawn when nothing is spent and there are no targets, nor outside a budget period', async () => {
    const empty = await mountNode(screen(track({ nws: nws({ amounts: { needsMinor: 0, wantsMinor: 0, savingsMinor: 0, notClassifiedMinor: 0 } }) })));
    expect(has(empty, 'nws-card')).toBe(false);
    const out = await mountNode(screen(track({ budgetsState: 'not_budget_period', nws: null })));
    expect(has(out, 'nws-card')).toBe(false);
  });
});

describe('Goals card (Story 7.7)', () => {
  it('one ring per goal with its name, amount of target and pace line, scoped to all time', async () => {
    const r = await mountNode(screen(track()));
    const t = texts(r);
    expect(t).toContain('Goals · all time');
    expect(t).toContain('Goa trip');
    expect(t.some((x) => /^₹5,000(\.00)? of ₹30,000(\.00)?$/.test(x))).toBe(true);
    expect(has(r, 'goal-ring-g1')).toBe(true);
  });

  it('a fully funded goal says so; tapping a ring opens its detail; with no goals the card is not drawn', async () => {
    const onOpenGoal = jest.fn();
    const r = await mountNode(screen(track({ goals: [goal({ funded: true, contributedMinor: 3_000_000, remainingMinor: 0 })] }), { onOpenGoal }));
    expect(texts(r)).toContain('Goa trip is fully funded');
    await press(r, 'goals-ring-g1');
    expect(onOpenGoal).toHaveBeenCalledWith('g1');
    const none = await mountNode(screen(track({ goals: [] })));
    expect(has(none, 'goals-card')).toBe(false);
  });

  it('View as table lists Goal, Contributed, Target and To go', async () => {
    const r = await mountNode(screen(track()));
    await press(r, 'goals-toggle');
    expect(has(r, 'goals-table')).toBe(true);
    expect(texts(r).some((x) => /₹5,000(\.00)? · ₹30,000(\.00)? · ₹25,000/.test(x))).toBe(true);
  });

  it('hidden amounts: no ring arc, no limit fill, amounts as dots, names and pace dates stay', async () => {
    useAmountsStore.getState().setHidden(true);
    const r = await mountNode(screen(track()));
    expect(texts(r).join(' ')).not.toMatch(/30,000|12,300|8,500/);
    expect(texts(r)).toContain('Goa trip');
    expect(r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'goal-ring-g1')[0]!.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('a failing load says so with Retry', async () => {
    const r = await mountNode(screen('error'));
    expect(has(r, 'track-error')).toBe(true);
    expect(has(r, 'budgets-card')).toBe(false);
  });
});
