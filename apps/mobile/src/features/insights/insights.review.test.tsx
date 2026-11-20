import { ActivityIndicator, Text } from 'react-native';
import { act, type ReactTestRenderer } from 'react-test-renderer';
import { budgetStatus, categoryView, type BudgetListRow, type CategorySpend, type Kept } from '@wmbugo/core';
import { useAmountsStore } from '../../shared/state/amountsHidden';
import { BarChart } from '../../shared/ui/BarChart';
import type { InsightsApi, OnTrackData } from './insightsApi';
import { InsightsScreen } from './InsightsScreen';
import { fakeInsightsApi, has, installInsightsHooks, mountNode, overview, press, settle, texts } from './insightsTestKit';
import { useInsightsStore } from './insightsStore';
import { clearInsightsSections } from './sectionRegistry';
import { insightsSections } from './sectionRegistry';
import { registerInsightsSections } from './sections';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Kolkata' } }));
installInsightsHooks();

const echo = { start: '2026-11-01', end: '2026-11-30', endExclusive: '2026-12-01', label: '1–30 Nov', filters: {} };
const cat = (id: string, name: string, spent: number, back = 0): CategorySpend => ({ categoryId: id, name, icon: 'Tag', colorToken: 'cat-rose', displayMinor: spent, backMinor: back });
const rows = [cat('rent', 'Rent', 1_800_000), cat('food', 'Food', 1_000_000)];

const categories = (rs: CategorySpend[] = []) => ({ currency: 'INR' as const, locale: 'en-IN', byCategory: { scope: echo, rows: rs }, total: { scope: echo, spentMinor: 2_800_000, backMinor: 0 }, view: categoryView(rs), scopeParts: [] });
const trendEmpty = { currency: 'INR' as const, locale: 'en-IN', trend: { scope: echo, granularity: 'day' as const, options: [], buckets: [], todayStart: null } };
const inoutEmpty = { currency: 'INR' as const, locale: 'en-IN', inOut: { scope: echo, periods: [] } };
const merchantsEmpty = { currency: 'INR' as const, locale: 'en-IN', scopeParts: [], merchants: { scope: echo, ranked: [], noMerchant: null, surplus: [] } };
const trackEmpty: OnTrackData = { currency: 'INR', locale: 'en-IN', thisMonth: '2026-11', track: { scope: echo, budgetsState: 'ok', budgets: [], nws: null, goals: [] } };

const brow = (id: string, name: string, used: number, target: number, over: Partial<BudgetListRow> = {}): BudgetListRow => ({
  id, name, group: '50_30_20', scope: 'budget_type', budgetType: 'need', period: { start: '2026-11-01', end: '2026-11-30', kind: 'pay_cycle' }, periodLabel: '1–30 Nov', usedMinor: used, targetMinor: target, refundSurplusMinor: 0,
  status: budgetStatus({ usedMinor: used, targetMinor: target, period: { start: '2026-11-01', end: '2026-11-30' }, today: '2026-11-08' }), overlapsOverall: false, ...over,
});

/** Everything a person or TalkBack can read: every text and every accessibility label. */
const readable = (r: ReactTestRenderer): string[] => [
  ...r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join('')),
  ...r.root.findAll((n) => typeof n.type === 'string' && typeof n.props.accessibilityLabel === 'string').map((n) => n.props.accessibilityLabel as string),
];

describe('every section handles loading, failure, Retry and an empty answer (review)', () => {
  type Loader = 'loadCategories' | 'loadTrend' | 'loadInOut' | 'loadMerchants' | 'loadOnTrack';
  const cases: { loader: Loader; error: string; retry: string; ok: unknown }[] = [
    { loader: 'loadCategories', error: 'where-error', retry: 'where-retry', ok: categories() },
    { loader: 'loadTrend', error: 'trend-error', retry: 'trend-error-retry', ok: trendEmpty },
    { loader: 'loadInOut', error: 'inout-error', retry: 'inout-error-retry', ok: inoutEmpty },
    { loader: 'loadMerchants', error: 'who-error', retry: 'who-retry', ok: merchantsEmpty },
    { loader: 'loadOnTrack', error: 'track-error', retry: 'track-error-retry', ok: trackEmpty },
  ];
  const screen = (api: InsightsApi) => {
    registerInsightsSections();
    return <InsightsScreen api={api} />;
  };

  it.each(cases)('$loader: a pending query shows a skeleton, not an error and not zeros', async ({ loader, error }) => {
    const api = fakeInsightsApi({ [loader]: jest.fn(() => new Promise(() => undefined)) } as Partial<InsightsApi>);
    const r = await mountNode(screen(api));
    expect(has(r, error)).toBe(false);
    expect(has(r, 'skeleton')).toBe(true);
  });

  it.each(cases)('$loader: a failure says so, Retry asks again, and the answer replaces the error', async ({ loader, error, retry, ok }) => {
    const load = jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(ok);
    const r = await mountNode(screen(fakeInsightsApi({ [loader]: load } as Partial<InsightsApi>)));
    expect(has(r, error)).toBe(true);
    await press(r, retry);
    expect(load.mock.calls.length).toBeGreaterThan(1);
    expect(has(r, error)).toBe(false);
  });

  it.each(cases)('$loader: an answer of nothing is an error with Retry, never a skeleton that never ends', async ({ loader, error }) => {
    const r = await mountNode(screen(fakeInsightsApi({ [loader]: jest.fn(async () => null) } as Partial<InsightsApi>)));
    expect(has(r, error)).toBe(true);
    expect(has(r, 'skeleton')).toBe(false);
  });

  it('the screen never shows a spinner', async () => {
    const r = await mountNode(screen(fakeInsightsApi()));
    expect(r.root.findAll((n) => n.type === ActivityIndicator)).toHaveLength(0);
  });

  it('registers the four questions in order', () => {
    clearInsightsSections();
    registerInsightsSections();
    expect(insightsSections().map((s) => s.heading)).toEqual(['Where did it go?', 'Is it going up?', 'Who got it?', 'Am I on track?']);
  });

  it('Am I on track? says what is missing instead of showing a heading with nothing under it', async () => {
    const r = await mountNode(screen(fakeInsightsApi({ loadOnTrack: jest.fn(async () => trackEmpty) })));
    expect(has(r, 'track-empty')).toBe(true);
    expect(texts(r)).toContain('Nothing to track yet. Add a budget or a goal in Plan.');
  });
});

describe('the overview fails one tile at a time (review)', () => {
  it('a figure that could not be read shows Couldn’t load this with Retry while the other tiles carry on', async () => {
    const o = overview({ failed: ['spent', 'kept'] });
    const api = fakeInsightsApi({ loadOverview: jest.fn(async () => o) });
    const r = await mountNode(<InsightsScreen api={api} />);
    expect(has(r, 'tile-spent-failed')).toBe(true);
    expect(has(r, 'tile-kept-failed')).toBe(true);
    expect(has(r, 'tile-income')).toBe(true);
    expect(has(r, 'tile-change')).toBe(true);
    expect(has(r, 'insights-period-chip')).toBe(true);
    await press(r, 'tile-spent-retry');
    expect((api.loadOverview as jest.Mock).mock.calls.length).toBeGreaterThan(1);
  });

  it('entries waiting for you stay reachable when nothing else is recorded in the period', async () => {
    const onReview = jest.fn();
    const r = await mountNode(<InsightsScreen api={fakeInsightsApi({ loadOverview: jest.fn(async () => overview({ entries: 0, waiting: 2 })) })} nav={{ onReview }} />);
    expect(has(r, 'insights-empty')).toBe(true);
    expect(texts(r)).toContain("2 waiting entries aren't counted · Review");
    await press(r, 'insights-waiting');
    expect(onReview).toHaveBeenCalled();
  });
});

describe('Hide amounts leaves no money, percent or arrow anywhere, tables and spoken labels included (review)', () => {
  const kept: Kept = { kind: 'kept', scope: echo, incomeMinor: 8_500_000, spentMinor: 300_000, keptPercent: 96, keptMinor: 8_200_000 };
  const track: OnTrackData = {
    ...trackEmpty,
    track: { ...trackEmpty.track, nws: { amounts: { needsMinor: 2_200_000, wantsMinor: 900_000, savingsMinor: 0, notClassifiedMinor: 0 }, needs: brow('n', 'Needs', 2_200_000, 5_000_000), wants: null, savings: null, notClassifiedCategoryIds: [], needsCategoryIds: ['cat_groceries'], wantsCategoryIds: [], period: { start: '2026-11-01', end: '2026-11-30' } } },
  };
  const trendData = { ...trendEmpty, trend: { ...trendEmpty.trend, options: ['day' as const], todayStart: '2026-11-08', buckets: [{ start: '2026-11-01', end: '2026-11-01', label: 'Nov 1', spentMinor: 100_000, backMinor: 0 }, { start: '2026-11-08', end: '2026-11-08', label: 'Nov 8', spentMinor: 300_000, backMinor: 0 }] } };
  const inoutData = { ...inoutEmpty, inOut: { scope: echo, periods: [{ start: '2026-11-01', end: '2026-11-30', label: 'Nov', incomeMinor: 8_500_000, spentMinor: 2_700_000, backMinor: 0, netMinor: 5_800_000, net: 'kept' as const }] } };
  const api = () => fakeInsightsApi({ loadOverview: jest.fn(async () => overview({ kept })), loadCategories: jest.fn(async () => categories(rows)), loadTrend: jest.fn(async () => trendData), loadInOut: jest.fn(async () => inoutData), loadOnTrack: jest.fn(async () => track) });
  const MONEY = /₹\s?\d|\d,\d{3}|\d{4,}|\d+\s?%|\d+ percent|rupees|[↑↓]/;

  it('with every table open and amounts hidden, nothing a person or TalkBack reads carries money, a percent or an arrow', async () => {
    useAmountsStore.getState().setHidden(true);
    registerInsightsSections();
    const r = await mountNode(<InsightsScreen api={api()} />);
    for (const t of ['kept-toggle', 'where-chart-toggle', 'trend-toggle', 'inout-toggle', 'nws-toggle']) await press(r, t);
    const leaks = readable(r).filter((x) => MONEY.test(x.replace(/\b2026-\d\d-\d\d\b/g, '')));
    expect(leaks).toEqual([]);
    expect(has(r, 'kept-table')).toBe(true);
    expect(has(r, 'nws-table')).toBe(true);
  });

  it('the chart summaries a screen reader hears name the chart and the period but no amount', async () => {
    useAmountsStore.getState().setHidden(true);
    registerInsightsSections();
    const r = await mountNode(<InsightsScreen api={api()} />);
    await press(r, 'inout-toggle');
    const summaries = readable(r).filter((x) => /^Spent by category, 1–30 Nov|^Spent per day, 1–30 Nov|^Nov, amounts hidden/.test(x));
    expect(summaries.length).toBe(3);
    // The period's own dates (`1–30 Nov`) are fine; an amount is three or more digits, a rupee word or a rupee sign.
    for (const s of summaries) expect(s).not.toMatch(/\d{3,}|rupees|₹/);
  });

  it('turning amounts back on restores the tables’ percents without reloading', async () => {
    useAmountsStore.getState().setHidden(true);
    registerInsightsSections();
    const a = api();
    const r = await mountNode(<InsightsScreen api={a} />);
    await press(r, 'kept-toggle');
    const before = (a.loadOverview as jest.Mock).mock.calls.length;
    await act(async () => useAmountsStore.getState().setHidden(false));
    await settle();
    expect(readable(r).join(' | ')).toMatch(/96%/);
    expect((a.loadOverview as jest.Mock).mock.calls.length).toBe(before);
  });
});

describe('what a tap opens (review)', () => {
  it('a donut label opens that category, and Needs and Wants bars open their entries in Activity; Savings is not tappable', async () => {
    const onDrill = jest.fn();
    const onSortIt = jest.fn();
    const track: OnTrackData = {
      ...trackEmpty,
      track: { ...trackEmpty.track, nws: { amounts: { needsMinor: 2_200_000, wantsMinor: 0, savingsMinor: 100_000, notClassifiedMinor: 0 }, needs: brow('n', 'Needs', 2_200_000, 5_000_000), wants: null, savings: brow('s', 'Savings', 100_000, 2_000_000, { scope: 'savings', budgetType: null }), notClassifiedCategoryIds: [], needsCategoryIds: ['cat_groceries'], wantsCategoryIds: [], period: { start: '2026-11-01', end: '2026-11-30' } } },
    };
    registerInsightsSections();
    const r = await mountNode(<InsightsScreen api={fakeInsightsApi({ loadCategories: jest.fn(async () => categories(rows)), loadOnTrack: jest.fn(async () => track) })} nav={{ onDrill, onSortIt }} />);
    await press(r, 'where-donut-label-rent');
    expect(onDrill).toHaveBeenLastCalledWith({ kind: 'category', id: 'rent', name: 'Rent' });
    await press(r, 'nws-bar-needs');
    expect(onSortIt).toHaveBeenCalledWith({ categoryIds: ['cat_groceries'], fromDate: '2026-11-01', toDate: '2026-11-30' });
    expect(has(r, 'nws-bar-savings')).toBe(false);
    expect(has(r, 'nws-limit-savings')).toBe(true);
  });

  it('a target that has no goal in Needs, Wants or Savings still shows its amount as a plain row', async () => {
    const track: OnTrackData = {
      ...trackEmpty,
      track: { ...trackEmpty.track, nws: { amounts: { needsMinor: 2_200_000, wantsMinor: 900_000, savingsMinor: 0, notClassifiedMinor: 0 }, needs: brow('n', 'Needs', 2_200_000, 5_000_000), wants: null, savings: null, notClassifiedCategoryIds: [], needsCategoryIds: [], wantsCategoryIds: [], period: { start: '2026-11-01', end: '2026-11-30' } } },
    };
    registerInsightsSections();
    const r = await mountNode(<InsightsScreen api={fakeInsightsApi({ loadOnTrack: jest.fn(async () => track) })} />);
    expect(has(r, 'nws-plain-wants')).toBe(true);
  });

  it('a row of the in and out table opens that period', async () => {
    const onDrill = jest.fn();
    registerInsightsSections();
    const inout = { ...inoutEmpty, inOut: { scope: echo, periods: [{ start: '2026-11-01', end: '2026-11-30', label: 'Nov', incomeMinor: 100_000, spentMinor: 50_000, backMinor: 0, netMinor: 50_000, net: 'kept' as const }] } };
    const r = await mountNode(<InsightsScreen api={fakeInsightsApi({ loadInOut: jest.fn(async () => inout) })} nav={{ onDrill }} />);
    await press(r, 'inout-toggle');
    await press(r, 'inout-row-2026-11-01');
    expect(onDrill).toHaveBeenCalledWith({ kind: 'bucket', start: '2026-11-01', end: '2026-11-30', label: 'Nov' });
  });
});

describe('the filter sheet (review)', () => {
  const facets = { accounts: [{ id: 'a1', name: 'HDFC' }], categories: [], merchants: [{ key: 'swiggy', name: 'Swiggy' }, { key: 'zomato', name: 'Zomato' }], tags: ['trip'], sources: [] };
  const screen = (load = jest.fn(async () => facets)) => <InsightsScreen api={fakeInsightsApi({ loadFacets: load })} />;

  it('Reset clears what was picked, the merchant search narrows the chips, a tag can be picked, and untoggling the last value drops the filter', async () => {
    const r = await mountNode(screen());
    await press(r, 'insights-filters-chip');
    await press(r, 'ifilter-account-a1');
    await press(r, 'ifilter-reset');
    await press(r, 'ifilter-apply');
    expect(useInsightsStore.getState().selection.filters).toEqual({});
    await press(r, 'insights-filters-chip');
    await act(async () => r.root.findAll((n) => n.props.testID === 'ifilter-merchant-search')[0]!.props.onChangeText('zom'));
    await settle();
    expect(has(r, 'ifilter-merchant-zomato')).toBe(true);
    expect(has(r, 'ifilter-merchant-swiggy')).toBe(false);
    await press(r, 'ifilter-tag-trip');
    await press(r, 'ifilter-tag-trip');
    await press(r, 'ifilter-tag-trip');
    await press(r, 'ifilter-apply');
    expect(useInsightsStore.getState().selection.filters).toEqual({ tags: ['trip'] });
    await press(r, 'insights-filters-chip');
    await press(r, 'ifilter-tag-trip');
    await press(r, 'ifilter-apply');
    expect(useInsightsStore.getState().selection.filters).toEqual({});
  });

  it('a value chosen earlier that the lists no longer offer is still shown, so it can be taken off', async () => {
    useInsightsStore.getState().setFilters({ accountIds: ['gone'] });
    const api = fakeInsightsApi({ loadFacets: jest.fn(async () => facets), loadOverview: jest.fn(async () => overview({ filterChips: [{ key: 'accountIds', value: 'gone', label: 'Old account' }] })) });
    const r = await mountNode(<InsightsScreen api={api} />);
    await press(r, 'insights-filters-chip');
    expect(has(r, 'ifilter-account-gone')).toBe(true);
    await press(r, 'ifilter-account-gone');
    await press(r, 'ifilter-apply');
    expect(useInsightsStore.getState().selection.filters).toEqual({});
  });

  it('a failed load says so instead of doing nothing, and a second tap while one is loading does not stack a second load', async () => {
    const failing = await mountNode(screen(jest.fn(async () => Promise.reject(new Error('x')))));
    await press(failing, 'insights-filters-chip');
    expect(texts(failing)).toContain("Couldn't load the filters. Try again.");
    expect(has(failing, 'insights-filter-sheet')).toBe(false);
    const slow = jest.fn(() => new Promise<typeof facets>(() => undefined));
    const r = await mountNode(screen(slow));
    await act(async () => {
      r.root.findAll((n) => n.props.testID === 'insights-filters-chip' && typeof n.props.onPress === 'function')[0]!.props.onPress();
      r.root.findAll((n) => n.props.testID === 'insights-filters-chip' && typeof n.props.onPress === 'function')[0]!.props.onPress();
    });
    expect(slow).toHaveBeenCalledTimes(1);
  });
});

describe('the selection store (review)', () => {
  it('picking a normal preset forgets a custom range, so it never lingers in a query key', () => {
    const s = useInsightsStore.getState();
    s.setPreset('custom', { start: '2026-11-01', end: '2026-11-05' });
    expect(useInsightsStore.getState().selection.custom).toEqual({ start: '2026-11-01', end: '2026-11-05' });
    useInsightsStore.getState().setPreset('last_month');
    expect(useInsightsStore.getState().selection).toEqual({ preset: 'last_month', filters: {} });
    useInsightsStore.getState().setPreset('default');
    expect(useInsightsStore.getState().selection.custom).toBeUndefined();
  });
});

describe('BarChart additions (review)', () => {
  const data = [{ id: 'a', label: 'Rent', valueMinor: 1_800_000, sharePercent: 53, detail: '3 entries' }, { id: 'b', label: 'Shopping', valueMinor: 0, detail: '1 entry' }];
  const chart = (table: boolean) => <BarChart title="T" scope="S" data={data} currency="INR" orientation="horizontal" table={table} onToggleTable={() => undefined} showShareInBars nameColumn="Merchant" detailColumn="Entries" testID="bc" />;

  it('draws the share beside a bar and not while amounts are hidden', async () => {
    const shown = await mountNode(chart(false));
    expect(has(shown, 'bc-share-a')).toBe(true);
    useAmountsStore.getState().setHidden(true);
    const hidden = await mountNode(chart(false));
    expect(has(hidden, 'bc-share-a')).toBe(false);
  });

  it('the table uses its own column titles, a dash for a missing share, and reads the detail after the amount', async () => {
    const r = await mountNode(chart(true));
    expect(texts(r)).toContain('Merchant');
    expect(texts(r)).toContain('Entries');
    expect(texts(r)).toContain('—');
    expect(texts(r)).toContain('3 entries');
    const row = r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'bc-row-a')[0]!;
    expect(row.props.accessibilityLabel).toMatch(/, 3 entries$/);
  });
});
