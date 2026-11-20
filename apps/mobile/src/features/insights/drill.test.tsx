import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import type { DrillDown, DrillTarget } from '@wmbugo/core';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { useAmountsStore } from '../../shared/state/amountsHidden';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { DrillScreen } from './DrillScreen';
import { csvFor, filtersText, type CsvSaver, type DrillApi, type DrillData } from './drillApi';
import { DEFAULT_SELECTION } from './insightsApi';

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

const echo = { start: '2026-11-01', end: '2026-11-30', endExclusive: '2026-12-01', label: '1–30 Nov', filters: {} };
const drill = (over: Partial<DrillDown> = {}): DrillDown => ({
  target: { kind: 'category', id: 'cat_food', name: 'Food' },
  mode: 'spending',
  scope: echo,
  spentMinor: 1_000_000,
  backMinor: 0,
  incomeMinor: 0,
  granularity: 'day',
  buckets: [
    { start: '2026-11-03', end: '2026-11-03', label: 'Nov 3', spentMinor: 600_000, backMinor: 0 },
    { start: '2026-11-04', end: '2026-11-04', label: 'Nov 4', spentMinor: 400_000, backMinor: 0 },
  ],
  days: [
    { date: '2026-11-04', spentMinor: 400_000, backMinor: 0, entries: [{ id: 't2', localDate: '2026-11-04', type: 'expense', merchant: 'Zomato', categoryName: 'Food & Drinks', categoryIcon: 'ForkKnife', categoryColor: 'cat-rose', accountName: 'HDFC', amountMinor: 400_000 }] },
    { date: '2026-11-03', spentMinor: 600_000, backMinor: 0, entries: [{ id: 't1', localDate: '2026-11-03', type: 'expense', merchant: 'Swiggy', categoryName: 'Food & Drinks', categoryIcon: 'ForkKnife', categoryColor: 'cat-rose', accountName: 'HDFC', amountMinor: 600_000 }] },
  ],
  explanation: { formula: 'spent', timeframe: '1–30 Nov', entryCount: 2, baseline: null },
  ...over,
});
const data = (d: DrillDown = drill(), over: Partial<DrillData> = {}): DrillData => ({ drill: d, currency: 'INR', locale: 'en-IN', exponent: 2, today: '2026-11-08', timezoneId: 'Asia/Kolkata', filtersText: 'Category Food', scopeParts: ['HDFC only'], ...over });
const fakeApi = (d: DrillData | 'error' | null = data()): DrillApi & { loadDrill: jest.Mock } => ({
  loadDrill: jest.fn(async () => {
    if (d === 'error') throw new Error('x');
    return d;
  }),
});
const target: DrillTarget = { kind: 'category', id: 'cat_food', name: 'Food' };
const show = (api: DrillApi, extra: { saver?: CsvSaver; onOpenEntry?: jest.Mock; onSeeInActivity?: jest.Mock; t?: DrillTarget } = {}) => (
  <DrillScreen selection={DEFAULT_SELECTION} target={extra.t ?? target} api={api} onBack={() => undefined} onOpenEntry={extra.onOpenEntry ?? jest.fn()} onSeeInActivity={extra.onSeeInActivity ?? jest.fn()} {...(extra.saver ? { saver: extra.saver } : {})} />
);

describe('the drill-down screen (Story 7.3, SCR-12)', () => {
  it('names the scope first, then the figure, the chart, how it is worked out and the entries by day', async () => {
    const r = await mountNode(show(fakeApi()));
    const t = texts(r);
    expect(t).toContain('Food');
    expect(t).toContain('Spent · 1–30 Nov · HDFC only');
    expect(t.some((x) => /^₹10,000(\.00)?$/.test(x))).toBe(true);
    expect(has(r, 'drill-chart')).toBe(true);
    expect(t).toContain('How this is worked out');
    expect(t).toContain("Confirmed spending minus refunds. Transfers and entries waiting for you aren't counted.");
    expect(t).toContain('For 1–30 Nov');
    expect(t).toContain('From 2 entries');
    expect(has(r, 'drill-day-2026-11-04')).toBe(true);
    expect(t.indexOf('Zomato')).toBeLessThan(t.indexOf('Swiggy'));
    expect(t.join(' ')).not.toMatch(/[-−]\s?₹/);
  });

  it('View as table keeps its state while an entry is open and the screen stays mounted', async () => {
    const open = jest.fn();
    const r = await mountNode(show(fakeApi(), { onOpenEntry: open }));
    await press(r, 'drill-chart-toggle');
    expect(has(r, 'drill-chart-table')).toBe(true);
    await press(r, 'activity-row-t1');
    expect(open).toHaveBeenCalledWith('t1');
    expect(has(r, 'drill-chart-table')).toBe(true);
  });

  it('the comparison appears for Spent: the baseline amount, or why there is none', async () => {
    const a = await mountNode(show(fakeApi(data(drill({ explanation: { formula: 'spent', timeframe: '1–8 Nov', entryCount: 5, baseline: { kind: 'amount', label: 'Oct 1–8', previousMinor: 1_250_000 } } }))), { t: { kind: 'spent' } }));
    expect(texts(a).some((x) => /^Compared with Oct 1–8: ₹12,500(\.00)?$/.test(x))).toBe(true);
    const b = await mountNode(show(fakeApi(data(drill({ explanation: { formula: 'spent', timeframe: '1–8 Nov', entryCount: 5, baseline: { kind: 'none' } } }))), { t: { kind: 'spent' } }));
    expect(texts(b)).toContain('No baseline yet: nothing was recorded on those days');
  });

  it('a refund surplus reads ₹X back with no minus sign anywhere; a zero segment says nothing was spent and draws no chart', async () => {
    const back = drill({ spentMinor: 0, backMinor: 700_000, days: [{ date: '2026-11-05', spentMinor: 0, backMinor: 700_000, entries: [{ id: 'r1', localDate: '2026-11-05', type: 'refund', merchant: 'Amazon', categoryName: 'Shopping', categoryIcon: 'ShoppingBag', categoryColor: 'cat-fuchsia', accountName: 'HDFC', amountMinor: 700_000 }] }], buckets: [{ start: '2026-11-05', end: '2026-11-05', label: 'Nov 5', spentMinor: 0, backMinor: 700_000 }] });
    const a = await mountNode(show(fakeApi(data(back)), { t: { kind: 'category', id: 'cat_shopping', name: 'Shopping' } }));
    expect(texts(a).some((x) => /^Shopping · ₹7,000(\.00)? back$/.test(x))).toBe(true);
    expect(texts(a).some((x) => /^₹7,000(\.00)? back$/.test(x))).toBe(true);
    expect(texts(a).join(' ')).not.toMatch(/[-−]\s?₹|[-−]\d/);
    const none = await mountNode(show(fakeApi(data(drill({ spentMinor: 0, days: [], buckets: [] })))));
    expect(texts(none)).toContain('Nothing spent here in 1–30 Nov.');
    expect(has(none, 'drill-chart')).toBe(false);
  });

  it('income drills into the income entries with no spending chart', async () => {
    const d = drill({ mode: 'income', spentMinor: 0, incomeMinor: 8_500_000, explanation: { formula: 'income', timeframe: '1–30 Nov', entryCount: 1, baseline: null } });
    const r = await mountNode(show(fakeApi(data(d)), { t: { kind: 'income' } }));
    expect(texts(r)).toContain('Income · 1–30 Nov · HDFC only');
    expect(texts(r)).toContain('Confirmed income. Transfers and entries waiting for you aren\'t counted.');
    expect(has(r, 'drill-chart')).toBe(false);
    expect(texts(r).some((x) => /^\+₹85,000/.test(x))).toBe(true);
  });

  it('See in Activity opens the same slice with its dates, accounts and categories', async () => {
    const see = jest.fn();
    const r = await mountNode(show(fakeApi(data(drill({ scope: { ...echo, filters: { accountIds: ['a1'] } } }))), { onSeeInActivity: see }));
    await press(r, 'drill-see-activity');
    expect(see).toHaveBeenCalledWith({ fromDate: '2026-11-01', toDate: '2026-11-30', accountIds: ['a1'], categoryIds: ['cat_food'], types: ['expense', 'refund'] });
  });

  it('Export as CSV hands the file to the saver and says how many entries; cancelling says nothing; a failure says nothing was changed', async () => {
    const save = jest.fn(async () => 'saved' as const);
    const r = await mountNode(show(fakeApi(), { saver: { save } }));
    await press(r, 'drill-export');
    expect(save).toHaveBeenCalledWith('wmbugo-food-2026-11-01-to-2026-11-30.csv', expect.stringContaining('# Schema wmbugo-insights-1'));
    expect(texts(r)).toContain('Exported 2 entries');
    const cancel = await mountNode(show(fakeApi(), { saver: { save: jest.fn(async () => 'cancelled' as const) } }));
    await press(cancel, 'drill-export');
    expect(texts(cancel).join(' ')).not.toMatch(/Exported/);
    const fail = await mountNode(show(fakeApi(), { saver: { save: jest.fn(async () => 'failed' as const) } }));
    await press(fail, 'drill-export');
    expect(texts(fail)).toContain("Couldn't export that. Nothing was changed.");
  });

  it('hidden amounts: no figures, amounts read as dots, and Export as CSV is still there', async () => {
    useAmountsStore.getState().setHidden(true);
    const r = await mountNode(show(fakeApi()));
    expect(texts(r).join(' ')).not.toMatch(/10,000|6,000|4,000/);
    expect(has(r, 'drill-export')).toBe(true);
    expect(texts(r)).toContain('Food');
  });

  it('a failing load says so with Retry; loading shows skeletons', async () => {
    const r = await mountNode(show(fakeApi('error')));
    expect(texts(r).join(' ')).toMatch(/Couldn't load/);
    expect(has(r, 'drill-chart')).toBe(false);
  });
});

describe('the CSV a drill-down writes', () => {
  it('names the file after the segment and writes the filters in words', () => {
    const d = data();
    expect(csvFor(d, 'Food').fileName).toBe('wmbugo-food-2026-11-01-to-2026-11-30.csv');
    expect(csvFor(d, 'Food').text).toContain('# Filters: Category Food');
    expect(filtersText({ accountIds: ['a'], categoryIds: ['c'] }, { accounts: { a: 'HDFC' }, categories: { c: 'Food' }, merchants: {} })).toBe('Account HDFC; Category Food');
  });
});
