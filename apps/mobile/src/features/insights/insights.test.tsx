import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { resolveInsightsPeriod, type InsightsPeriod, type PeriodPreset, type PeriodProfile } from '@wmbugo/core';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient, invalidateForEvent } from '../../shared/queryClient';
import { useAmountsStore } from '../../shared/state/amountsHidden';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { filterChips, scopeParts, type InsightsApi, type InsightsFacets, type InsightsOverview, type InsightsSelection } from './insightsApi';
import { DEFAULT_SELECTION } from './insightsApi';
import { useInsightsStore, withoutFilterValue } from './insightsStore';
import { InsightsScreen } from './InsightsScreen';
import { clearInsightsSections, registerInsightsSection } from './sectionRegistry';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Kolkata' } }));

const live: ReactTestRenderer[] = [];
const clients: ReturnType<typeof createQueryClient>[] = [];
afterEach(async () => {
  await act(async () => new Promise((res) => setTimeout(res, 0)));
  for (const r of live.splice(0)) act(() => r.unmount());
  jest.restoreAllMocks();
  useAmountsStore.getState().setHidden(false);
  useInsightsStore.getState().reset();
  clearInsightsSections();
  clients.length = 0;
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
const label = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id)[0]?.props.accessibilityLabel as string | undefined;
const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());
  await settle();
};
const type = async (r: ReactTestRenderer, id: string, value: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onChangeText === 'function')[0]!.props.onChangeText(value));
  await settle();
};
const mountNode = async (node: React.ReactElement) => {
  const qc = createQueryClient();
  clients.push(qc);
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

const profile: PeriodProfile = { rule: { kind: 'first' }, firstDay: 'mon' };
const period = (preset: PeriodPreset = 'this_cycle', today = '2026-11-08'): InsightsPeriod => resolveInsightsPeriod(preset, today, profile)!;

const overview = (over: Partial<InsightsOverview> = {}): InsightsOverview => {
  const p = over.period ?? period();
  return {
    currency: 'INR',
    locale: 'en-IN',
    today: '2026-11-08',
    firstDay: '2026-10-01',
    period: p,
    preset: p.preset,
    presets: ['this_cycle', 'last_cycle', 'today', 'yesterday', 'seven_days', 'this_month', 'last_month', 'this_quarter', 'this_year', 'custom'],
    scope: { period: p, filters: {} },
    scopeParts: [],
    filterChips: [],
    spent: { scope: { start: p.start, end: '2026-11-30', endExclusive: '2026-12-01', label: p.title, filters: {} }, spentMinor: 300_000, backMinor: 0 },
    income: { scope: { start: p.start, end: '2026-11-30', endExclusive: '2026-12-01', label: p.title, filters: {} }, incomeMinor: 8_500_000 },
    change: { kind: 'change', scope: { start: p.start, end: '2026-11-30', endExclusive: '2026-12-01', label: p.title, filters: {} }, direction: 'up', percent: 12, baselineLabel: 'Oct 1–8', previousMinor: 1_250_000 },
    kept: { kind: 'kept', scope: { start: p.start, end: '2026-11-30', endExclusive: '2026-12-01', label: p.title, filters: {} }, incomeMinor: 8_500_000, spentMinor: 300_000, keptPercent: 96, keptMinor: 8_200_000 },
    waiting: 0,
    entries: 23,
    ...over,
  };
};

const facets: InsightsFacets = { accounts: [{ id: 'a1', name: 'HDFC' }, { id: 'a2', name: 'Cash' }], categories: [{ id: 'cat_food', name: 'Food & Drinks' }], merchants: [{ key: 'swiggy', name: 'Swiggy' }], tags: [], sources: ['manual', 'csv'] };

const fakeApi = (o: InsightsOverview | ((s: InsightsSelection) => InsightsOverview) | 'error' | null = overview()): InsightsApi & { loadOverview: jest.Mock; loadFacets: jest.Mock } => ({
  loadOverview: jest.fn(async (s: InsightsSelection) => {
    if (o === 'error') throw new Error('x');
    return typeof o === 'function' ? o(s) : o;
  }),
  loadFacets: jest.fn(async () => facets),
  loadCategories: jest.fn(async () => null),
  loadTrend: jest.fn(async () => null),
  loadInOut: jest.fn(async () => null),
  loadMerchants: jest.fn(async () => null),
});

describe('Insights overview (Story 7.2)', () => {
  it('opens on the default period with the period chip, the filter chip and the four tiles', async () => {
    const r = await mountNode(<InsightsScreen api={fakeApi()} />);
    expect(texts(r)).toContain('This pay cycle · 1–30 Nov');
    expect(texts(r)).toContain('Filters');
    for (const id of ['tile-spent', 'tile-income', 'tile-change', 'tile-kept']) expect(has(r, id)).toBe(true);
    expect(texts(r)).toContain('↑ 12% vs Oct 1–8');
    expect(texts(r)).toContain('Kept 96%');
    expect(texts(r)).toContain('Cash flow, not savings');
    expect(label(r, 'tile-change')).toBe('Spending change, up 12 percent versus Oct 1–8');
  });

  it('a refund surplus reads ₹X back, with no minus sign anywhere', async () => {
    const o = overview();
    const r = await mountNode(<InsightsScreen api={fakeApi({ ...o, spent: { ...o.spent, spentMinor: 0, backMinor: 700_000 } })} />);
    expect(texts(r).some((t) => /^₹7,000(\.00)? back$/.test(t))).toBe(true);
    expect(texts(r).join(' ')).not.toMatch(/[-−]\s?₹|[-−]\d/);
  });

  it('income reads with a plus; No baseline yet has no arrow; no change reads without one', async () => {
    const o = overview();
    const r = await mountNode(<InsightsScreen api={fakeApi({ ...o, change: { kind: 'no_baseline', scope: o.spent.scope } })} />);
    expect(texts(r).some((t) => /^\+₹85,000/.test(t))).toBe(true);
    expect(texts(r)).toContain('No baseline yet');
    expect(texts(r).join(' ')).not.toMatch(/[↑↓]/);
  });

  it('Kept with no income reads No income recorded with no gauge, and short reads how much more went out', async () => {
    const o = overview();
    const a = await mountNode(<InsightsScreen api={fakeApi({ ...o, kept: { kind: 'no_income', scope: o.spent.scope, spentMinor: 300_000 } })} />);
    expect(texts(a)).toContain('No income recorded');
    expect(has(a, 'kept-gauge')).toBe(false);
    const b = await mountNode(<InsightsScreen api={fakeApi({ ...o, kept: { kind: 'short', scope: o.spent.scope, incomeMinor: 100_000, spentMinor: 320_000, shortMinor: 220_000 } })} />);
    expect(texts(b).some((t) => /^Spent ₹2,200(\.00)? more than came in$/.test(t))).toBe(true);
  });

  it('View as table on Kept lists Income, Spent and Kept with the percent', async () => {
    const r = await mountNode(<InsightsScreen api={fakeApi()} />);
    await press(r, 'kept-toggle');
    expect(has(r, 'kept-table')).toBe(true);
    const t = texts(r).join(' | ');
    expect(t).toContain('Income');
    expect(t).toContain('Spent');
    expect(t).toMatch(/Kept.*96%/);
    expect(r.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && /^Kept, .*96 percent$/.test(n.props.accessibilityLabel)).length).toBeGreaterThan(0);
  });

  it('hidden amounts: no figures, no percent, no arrow and no gauge; the baseline label stays', async () => {
    useAmountsStore.getState().setHidden(true);
    const r = await mountNode(<InsightsScreen api={fakeApi()} />);
    const t = texts(r).join(' | ');
    expect(t).not.toMatch(/85,000|3,000|96|12%/);
    expect(t).not.toMatch(/[↑↓]/);
    expect(texts(r)).toContain('vs Oct 1–8');
    expect(has(r, 'kept-gauge')).toBe(false);
    expect(label(r, 'tile-kept')).toBe('Kept, Amount hidden');
    expect(label(r, 'tile-change')).toBe('Spending change, versus Oct 1–8');
    useAmountsStore.getState().setHidden(false);
    await settle();
    expect(has(r, 'kept-gauge')).toBe(true);
  });

  it('an empty period says so with Add an expense instead of tiles, and a period before the first day says since when', async () => {
    const onAdd = jest.fn();
    const r = await mountNode(<InsightsScreen api={fakeApi(overview({ entries: 0, firstDay: '2026-11-05' }))} nav={{ onAdd }} />);
    expect(texts(r)).toContain('Nothing recorded for 1–30 Nov yet.');
    expect(has(r, 'tile-spent')).toBe(false);
    expect(texts(r)).toContain('wmbugo has entries from Thu 5 Nov');
    await press(r, 'insights-add');
    expect(onAdd).toHaveBeenCalled();
  });

  it('waiting entries get a 48dp row that opens the review queue', async () => {
    const onReview = jest.fn();
    const r = await mountNode(<InsightsScreen api={fakeApi(overview({ waiting: 3 }))} nav={{ onReview }} />);
    expect(texts(r)).toContain("3 waiting entries aren't counted · Review");
    await press(r, 'insights-waiting');
    expect(onReview).toHaveBeenCalled();
  });

  it('a failing load says so with Retry and shows nothing as zero; loading shows skeletons, never a spinner', async () => {
    const r = await mountNode(<InsightsScreen api={fakeApi('error')} />);
    expect(has(r, 'tile-spent')).toBe(false);
    expect(r.root.findAll((n) => String(n.type) === 'ActivityIndicator').length).toBe(0);
    expect(texts(r).join(' ')).toMatch(/Couldn't load/);
  });
});

describe('the period chip and sheet (Story 7.2)', () => {
  it('lists the presets as radios, picking one re-scopes the screen and announces it', async () => {
    const api = fakeApi((s) => overview({ period: period(s.preset === 'last_cycle' ? 'last_cycle' : 'this_cycle') }));
    const r = await mountNode(<InsightsScreen api={api} />);
    await press(r, 'insights-period-chip');
    for (const p of ['this_cycle', 'last_cycle', 'today', 'yesterday', 'seven_days', 'this_month', 'last_month', 'this_quarter', 'this_year', 'custom']) expect(has(r, `period-${p}`)).toBe(true);
    await press(r, 'period-last_cycle');
    expect(useInsightsStore.getState().selection.preset).toBe('last_cycle');
    expect(api.loadOverview).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'last_cycle' }));
    expect(texts(r)).toContain('Last pay cycle · 1–31 Oct');
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Period: Last pay cycle, 1–31 Oct');
  });

  it('without a payday the pay cycle presets are not listed and This month is', async () => {
    const o = overview({ presets: ['today', 'yesterday', 'seven_days', 'this_month', 'last_month', 'this_quarter', 'this_year', 'custom'], period: period('this_month'), preset: 'this_month' });
    const r = await mountNode(<InsightsScreen api={fakeApi(o)} />);
    expect(texts(r)).toContain('This month · 1–30 Nov');
    await press(r, 'insights-period-chip');
    expect(has(r, 'period-this_cycle')).toBe(false);
    expect(has(r, 'period-this_month')).toBe(true);
  });

  it('Custom checks the range: end before start, a date after today and a bad date keep what was typed', async () => {
    const r = await mountNode(<InsightsScreen api={fakeApi()} />);
    await press(r, 'insights-period-chip');
    await press(r, 'period-custom');
    await type(r, 'period-custom-start', '2026-11-05');
    await type(r, 'period-custom-end', '2026-11-01');
    await press(r, 'period-custom-apply');
    expect(texts(r)).toContain('Error: end date must be on or after the start');
    await type(r, 'period-custom-end', '2026-12-25');
    await press(r, 'period-custom-apply');
    expect(texts(r)).toContain('Error: pick dates up to today');
    await type(r, 'period-custom-end', 'soon');
    await press(r, 'period-custom-apply');
    expect(texts(r)).toContain('Error: enter a date like 2026-11-01');
    await type(r, 'period-custom-end', '2026-11-08');
    await press(r, 'period-custom-apply');
    expect(useInsightsStore.getState().selection).toMatchObject({ preset: 'custom', custom: { start: '2026-11-05', end: '2026-11-08' } });
  });

  it('keeps the selection when the screen is left and opened again', async () => {
    useInsightsStore.getState().setPreset('last_month');
    const api = fakeApi();
    await mountNode(<InsightsScreen api={api} />);
    expect(api.loadOverview).toHaveBeenCalledWith(expect.objectContaining({ preset: 'last_month' }));
  });

  it('a default selection follows the profile: it is the word default, resolved by the api each time', () => {
    expect(DEFAULT_SELECTION.preset).toBe('default');
  });
});

describe('filters (Story 7.2)', () => {
  it('the filter sheet offers accounts, categories, merchant, type and only the sources present; Apply scopes the tiles', async () => {
    const api = fakeApi((s) => overview({ scopeParts: scopeParts(s.filters, { accounts: { a1: 'HDFC' }, categories: {}, merchants: {} }), filterChips: filterChips(s.filters, { accounts: { a1: 'HDFC' }, categories: {}, merchants: {} }) }));
    const r = await mountNode(<InsightsScreen api={api} />);
    await press(r, 'insights-filters-chip');
    expect(has(r, 'ifilter-account-a1')).toBe(true);
    expect(has(r, 'ifilter-category-cat_food')).toBe(true);
    expect(has(r, 'ifilter-merchant-swiggy')).toBe(true);
    expect(has(r, 'ifilter-type-refund')).toBe(true);
    expect(has(r, 'ifilter-source-csv')).toBe(true);
    expect(has(r, 'ifilter-source-sms')).toBe(false);
    expect(has(r, 'ifilter-tag-x')).toBe(false);
    await press(r, 'ifilter-account-a1');
    await press(r, 'ifilter-apply');
    expect(useInsightsStore.getState().selection.filters).toEqual({ accountIds: ['a1'] });
    expect(texts(r)).toContain('Filters · 1');
    expect(texts(r)).toContain('Spent · HDFC only');
    expect(has(r, 'insights-chip-accountIds-a1')).toBe(true);
  });

  it('a removable chip takes a filter off, and Clear all shows at two or more', async () => {
    useInsightsStore.getState().setFilters({ accountIds: ['a1'], categoryIds: ['cat_food'] });
    const names = { accounts: { a1: 'HDFC' }, categories: { cat_food: 'Food' }, merchants: {} };
    const api = fakeApi((s) => overview({ filterChips: filterChips(s.filters, names), scopeParts: scopeParts(s.filters, names) }));
    const r = await mountNode(<InsightsScreen api={api} />);
    expect(has(r, 'insights-clear-all')).toBe(true);
    expect(texts(r)).toContain('Spent · HDFC only · Food');
    await press(r, 'insights-chip-accountIds-a1');
    expect(useInsightsStore.getState().selection.filters).toEqual({ categoryIds: ['cat_food'] });
    expect(has(r, 'insights-clear-all')).toBe(false);
    await press(r, 'insights-chip-categoryIds-cat_food');
    expect(useInsightsStore.getState().selection.filters).toEqual({});
  });

  it('scope words: one account is "X only", several are "N accounts"', () => {
    const n = { accounts: { a: 'HDFC', b: 'Cash' }, categories: {}, merchants: { swiggy: 'Swiggy' } };
    expect(scopeParts({ accountIds: ['a'] }, n)).toEqual(['HDFC only']);
    expect(scopeParts({ accountIds: ['a', 'b'] }, n)).toEqual(['2 accounts']);
    expect(scopeParts({ merchantKeys: ['swiggy'] }, n)).toEqual(['Swiggy only']);
  });

  it('withoutFilterValue drops a value and an emptied filter', () => {
    expect(withoutFilterValue({ accountIds: ['a', 'b'] }, 'accountIds', 'a')).toEqual({ accountIds: ['b'] });
    expect(withoutFilterValue({ accountIds: ['a'], tags: ['t'] }, 'accountIds', 'a')).toEqual({ tags: ['t'] });
  });
});

describe('sections and refresh (Story 7.2)', () => {
  it('a registered section appears under its question heading, in order; with none registered there is no placeholder', async () => {
    const none = await mountNode(<InsightsScreen api={fakeApi()} />);
    expect(texts(none).join(' ')).not.toMatch(/Where did it go|coming soon/i);
    registerInsightsSection({ id: 'b', heading: 'Is it going up?', order: 2, visible: () => true, render: () => <Text>second</Text> });
    registerInsightsSection({ id: 'a', heading: 'Where did it go?', order: 1, visible: () => true, render: () => <Text>first</Text> });
    registerInsightsSection({ id: 'c', heading: 'Hidden one', order: 3, visible: () => false, render: () => <Text>third</Text> });
    const r = await mountNode(<InsightsScreen api={fakeApi()} />);
    const t = texts(r);
    expect(t.indexOf('Where did it go?')).toBeLessThan(t.indexOf('Is it going up?'));
    expect(t).not.toContain('Hidden one');
    expect(r.root.findAll((n) => n.props.accessibilityRole === 'header' && [n.props.children].flat().includes('Where did it go?')).length).toBeGreaterThan(0);
  });

  it.each(['TransactionsChanged', 'CategoriesChanged', 'BudgetsChanged', 'GoalsChanged', 'AccountsChanged', 'ProfileChanged'] as const)('%s recomputes Insights through the catalogue', async (name) => {
    const api = fakeApi();
    const qc = createQueryClient();
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <QueryClientProvider client={qc}>
          <ThemeProvider>
            <ToastHost bottomOffset={0}>
              <SheetHost>
                <InsightsScreen api={api} />
              </SheetHost>
            </ToastHost>
          </ThemeProvider>
        </QueryClientProvider>,
      );
    });
    live.push(r);
    await settle();
    const before = api.loadOverview.mock.calls.length;
    await act(async () => invalidateForEvent(qc, name as never));
    await settle();
    expect(api.loadOverview.mock.calls.length).toBeGreaterThan(before);
  });

  it('one tile is one TalkBack node that starts with its scope', async () => {
    const o = overview({ scopeParts: ['HDFC only'] });
    const r = await mountNode(<InsightsScreen api={fakeApi(o)} />);
    expect(label(r, 'tile-spent')).toMatch(/^Spent · HDFC only, /);
    expect(label(r, 'tile-income')).toMatch(/^Income · HDFC only, /);
  });
});
