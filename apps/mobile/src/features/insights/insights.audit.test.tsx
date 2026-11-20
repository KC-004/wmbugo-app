import { Text } from 'react-native';
import { act, type ReactTestRenderer } from 'react-test-renderer';
import { budgetStatus, categoryView, type BudgetListRow, type CategorySpend, type GoalRow, type MerchantSpend } from '@wmbugo/core';
import { copy } from '../../shared/copy';
import { useAmountsStore } from '../../shared/state/amountsHidden';
import { InsightsScreen } from './InsightsScreen';
import { fakeInsightsApi, has, installInsightsHooks, mountNode, overview, press, settle } from './insightsTestKit';
import { registerInsightsSections } from './sections';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Kolkata' } }));
let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 400, height: 800, scale: 2, fontScale: mockFontScale }),
}));
installInsightsHooks();
afterEach(() => {
  mockFontScale = 1;
});

const echo = { start: '2026-11-01', end: '2026-11-30', endExclusive: '2026-12-01', label: '1–30 Nov', filters: {} };
const cat = (id: string, name: string, spent: number, back = 0): CategorySpend => ({ categoryId: id, name, icon: 'Tag', colorToken: 'cat-rose', displayMinor: spent, backMinor: back });
const rows = [cat('rent', 'Rent', 1_800_000), cat('food', 'Food', 1_000_000), cat('shop', 'Shopping', 0, 700_000)];
const m = (key: string, name: string, spent: number, entries: number, back = 0): MerchantSpend => ({ key, name, displayMinor: spent, backMinor: back, entries, noMerchant: false });
const brow = (id: string, name: string, used: number, target: number, over: Partial<BudgetListRow> = {}): BudgetListRow => ({
  id, name, group: 'categories', scope: 'category', budgetType: null, period: { start: '2026-11-01', end: '2026-11-30', kind: 'pay_cycle' }, periodLabel: '1–30 Nov', usedMinor: used, targetMinor: target, refundSurplusMinor: 0,
  status: budgetStatus({ usedMinor: used, targetMinor: target, period: { start: '2026-11-01', end: '2026-11-30' }, today: '2026-11-08' }), overlapsOverall: false, ...over,
});
const goal: GoalRow = { id: 'g1', name: 'Goa trip', targetMinor: 3_000_000, dueDate: '2027-03-01', icon: 'Airplane', color: 'cat-cyan', accountId: null, accountName: null, state: 'active', setAsideMinor: 500_000, movedMinor: 0, contributedMinor: 500_000, remainingMinor: 2_500_000, funded: false, accountIsPot: false, progress: null };

function everything() {
  registerInsightsSections();
  const api = fakeInsightsApi({
    loadOverview: jest.fn(async () => overview({ waiting: 2 })),
    loadCategories: jest.fn(async () => ({ currency: 'INR' as const, locale: 'en-IN', byCategory: { scope: echo, rows }, total: { scope: echo, spentMinor: 2_100_000, backMinor: 0 }, view: categoryView(rows), scopeParts: [] })),
    loadTrend: jest.fn(async () => ({
      currency: 'INR' as const,
      locale: 'en-IN',
      trend: { scope: echo, granularity: 'day' as const, options: ['day' as const], todayStart: '2026-11-08', buckets: [{ start: '2026-11-01', end: '2026-11-01', label: 'Nov 1', spentMinor: 100_000, backMinor: 0 }, { start: '2026-11-02', end: '2026-11-02', label: 'Nov 2', spentMinor: 0, backMinor: 120_000 }, { start: '2026-11-08', end: '2026-11-08', label: 'Nov 8', spentMinor: 300_000, backMinor: 0 }] },
    })),
    loadInOut: jest.fn(async () => ({ currency: 'INR' as const, locale: 'en-IN', inOut: { scope: echo, periods: [{ start: '2026-11-01', end: '2026-11-30', label: 'Nov', incomeMinor: 8_500_000, spentMinor: 2_700_000, backMinor: 0, netMinor: 5_800_000, net: 'kept' as const }] } })),
    loadMerchants: jest.fn(async () => ({ currency: 'INR' as const, locale: 'en-IN', scopeParts: [], merchants: { scope: echo, ranked: [m('swiggy', 'Swiggy', 645_000, 14)], noMerchant: null, surplus: [m('amazon', 'Amazon', 0, 1, 200_000)] } })),
    loadOnTrack: jest.fn(async () => ({
      currency: 'INR' as const,
      locale: 'en-IN',
      thisMonth: '2026-11',
      track: { scope: echo, budgetsState: 'ok' as const, budgets: [brow('o', 'Overall', 1_230_000, 5_000_000, { group: 'overall', scope: 'overall', refundSurplusMinor: 700_000 })], nws: { amounts: { needsMinor: 2_200_000, wantsMinor: 900_000, savingsMinor: 0, notClassifiedMinor: 300_000 }, needs: null, wants: null, savings: null, notClassifiedCategoryIds: [], period: { start: '2026-11-01', end: '2026-11-30' } }, goals: [goal] },
    })),
  });
  return { api, node: <InsightsScreen api={api} nav={{ onDrill: jest.fn() }} /> };
}

/** Everything a person or TalkBack can read: every text and every accessibility label. */
const readable = (r: ReactTestRenderer): string[] => [
  ...r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join('')),
  ...r.root.findAll((n) => typeof n.type === 'string' && typeof n.props.accessibilityLabel === 'string').map((n) => n.props.accessibilityLabel as string),
];

describe('the Insights audit (Story 7.8)', () => {
  it('shows the four questions in order as headings', async () => {
    const r = await mountNode(everything().node);
    const headings = r.root.findAll((n) => n.props.accessibilityRole === 'header').map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
    const order = ['Where did it go?', 'Is it going up?', 'Who got it?', 'Am I on track?'].map((h) => headings.indexOf(h));
    expect(order.every((x) => x >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('with Hide amounts on, no money, percent, arrow, fill, ring or gauge is visible or announced; scope, names and View as table stay', async () => {
    useAmountsStore.getState().setHidden(true);
    const { node } = everything();
    const r = await mountNode(node);
    const all = readable(r).join(' | ');
    expect(all).not.toMatch(/₹\s?\d|\d,\d{3}|\d+\s?%|\d+ percent|[↑↓]/);
    for (const stays of ['1–30 Nov', 'Rent', 'Swiggy', 'Goa trip', 'View as table']) expect(all).toContain(stays);
    for (const id of ['kept-gauge']) expect(has(r, id)).toBe(false);
    for (const id of ['where-chart-fill-rent', 'who-chart-fill-swiggy', 'inout-in-fill-2026-11-01']) expect(has(r, id)).toBe(false);
  });

  it('turning it off again restores everything without loading the data again', async () => {
    useAmountsStore.getState().setHidden(true);
    const { api, node } = everything();
    const r = await mountNode(node);
    const calls = ['loadOverview', 'loadCategories', 'loadTrend', 'loadInOut', 'loadMerchants', 'loadOnTrack'].map((k) => (api[k as keyof typeof api] as jest.Mock).mock.calls.length);
    await act(async () => useAmountsStore.getState().setHidden(false));
    await settle();
    expect(readable(r).join(' | ')).toMatch(/₹/);
    expect(has(r, 'kept-gauge')).toBe(true);
    const after = ['loadOverview', 'loadCategories', 'loadTrend', 'loadInOut', 'loadMerchants', 'loadOnTrack'].map((k) => (api[k as keyof typeof api] as jest.Mock).mock.calls.length);
    expect(after).toEqual(calls);
  });

  it('no minus sign or hyphen comes before an amount or a percent anywhere, refund surpluses included', async () => {
    const r = await mountNode(everything().node);
    expect(readable(r).join(' | ')).not.toMatch(/[-−]\s?(₹|\d)/);
    expect(readable(r).filter((x) => /back$/.test(x)).length).toBeGreaterThan(0);
  });

  it('every Insights copy string is free of a minus before an amount or percent', () => {
    for (const [k, v] of Object.entries(copy.insights)) {
      if (typeof v !== 'string') continue;
      // A hyphen inside an ISO date (`2026-11-01`) is not a minus: only one that starts a word counts.
      expect({ k, bad: /(?<![\d\w])[-−]\s?(\{amount\}|\{percent\}|₹|\d)/.test(v) }).toEqual({ k, bad: false });
    }
  });

  it('each chart is one summary node followed by View as table, and table mode reads each row as one node', async () => {
    const r = await mountNode(everything().node);
    for (const toggle of ['where-chart-toggle', 'trend-toggle', 'inout-toggle', 'who-chart-toggle', 'budgets-toggle', 'goals-toggle', 'kept-toggle']) expect(has(r, toggle)).toBe(true);
    const summaries = readable(r).filter((x) => /^Spent by category, 1–30 Nov, \d categories, highest Rent/.test(x) || /^Spent per day, 1–30 Nov, highest/.test(x));
    expect(summaries.length).toBe(2);
    await press(r, 'who-chart-toggle');
    const row = r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'who-chart-row-swiggy')[0]!;
    expect(row.props.accessibilityLabel).toMatch(/14 entries/);
  });

  it('the tiles stack in one column at large text sizes, and sit in a grid otherwise', async () => {
    const grid = await mountNode(everything().node);
    const style = (id: string, r: ReactTestRenderer) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id)[0]!.props.style;
    expect([style('kpi-tiles', grid)].flat(Infinity).some((s) => s && (s as { flexDirection?: string }).flexDirection === 'row')).toBe(true);
    mockFontScale = 2;
    const stacked = await mountNode(everything().node);
    expect([style('kpi-tiles', stacked)].flat(Infinity).some((s) => s && (s as { flexDirection?: string }).flexDirection === 'row')).toBe(false);
  });

  it('the screen never shows a spinner', async () => {
    const r = await mountNode(everything().node);
    expect(r.root.findAll((n) => String(n.type) === 'ActivityIndicator').length).toBe(0);
  });
});
