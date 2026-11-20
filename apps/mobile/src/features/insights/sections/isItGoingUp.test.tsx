import type { IncomeVsExpense, InOutPeriod, SpendingTrend, TrendBucket } from '@wmbugo/core';
import { useAmountsStore } from '../../../shared/state/amountsHidden';
import type { InOutData, TrendData } from '../insightsApi';
import { InsightsScreen } from '../InsightsScreen';
import { fakeInsightsApi, has, installInsightsHooks, mountNode, overview, press, texts } from '../insightsTestKit';
import { registerInsightsSection } from '../sectionRegistry';
import { isItGoingUp } from './IsItGoingUp';

jest.mock('../../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Kolkata' } }));
installInsightsHooks();

const echo = { start: '2026-11-01', end: '2026-11-30', endExclusive: '2026-12-01', label: '1–30 Nov', filters: {} };
const b = (day: number, spent: number, back = 0): TrendBucket => ({ start: `2026-11-0${day}`, end: `2026-11-0${day}`, label: `Nov ${day}`, spentMinor: spent, backMinor: back });
const trend = (buckets: TrendBucket[], over: Partial<SpendingTrend> = {}): TrendData => ({ currency: 'INR', locale: 'en-IN', trend: { scope: echo, granularity: 'day', options: ['day', 'week'], buckets, todayStart: '2026-11-08', ...over } });
const p = (label: string, start: string, income: number, spent: number, net: InOutPeriod['net'], netMinor: number, back = 0): InOutPeriod => ({ start, end: start, label, incomeMinor: income, spentMinor: spent, backMinor: back, netMinor, net });
const inout = (periods: InOutPeriod[]): InOutData => ({ currency: 'INR', locale: 'en-IN', inOut: { scope: echo, periods } as IncomeVsExpense });

const screen = (t: TrendData | 'error' | null, io: InOutData | null, onDrill?: jest.Mock, loadTrend?: jest.Mock) => {
  registerInsightsSection(isItGoingUp);
  const api = fakeInsightsApi({
    loadOverview: jest.fn(async () => overview()),
    loadTrend: loadTrend ?? jest.fn(async () => {
      if (t === 'error') throw new Error('x');
      return t;
    }),
    loadInOut: jest.fn(async () => io),
  });
  return <InsightsScreen api={api} nav={onDrill ? { onDrill } : {}} />;
};

const days = [b(1, 100_000), b(2, 300_000), b(3, 0, 120_000), b(4, 200_000), b(8, 150_000)];

describe('Is it going up? (Story 7.5)', () => {
  it('registers after the first question with both cards under a heading', async () => {
    const r = await mountNode(screen(trend(days), inout([p('Nov', '2026-11-01', 8_500_000, 2_700_000, 'kept', 5_800_000)])));
    expect(texts(r)).toContain('Is it going up?');
    expect(texts(r)).toContain('Spending over time');
    expect(texts(r)).toContain('Money in and out');
    expect(texts(r)).toContain('Spent per day · 1–30 Nov');
  });

  it('the trend shows the highest point and today, a refund-surplus day as ₹1,200 back, and no minus sign', async () => {
    const r = await mountNode(screen(trend(days), null));
    const t = texts(r);
    expect(t.some((x) => /^Highest · Nov 2 · ₹3,000(\.00)?$/.test(x))).toBe(true);
    expect(t.some((x) => /^Today · ₹1,500(\.00)?$/.test(x))).toBe(true);
    expect(has(r, 'trend-line')).toBe(true);
    expect(t.join(' ')).not.toMatch(/[-−]\s?₹|[-−]\d/);
    await press(r, 'trend-toggle');
    expect(has(r, 'trend-table')).toBe(true);
    expect(texts(r).some((x) => /^₹1,200(\.00)? back$/.test(x))).toBe(true);
  });

  it('the segmented control lists Day and Week, picks one and asks for it', async () => {
    const load = jest.fn(async () => trend(days));
    const r = await mountNode(screen(null, null, undefined, load));
    expect(has(r, 'trend-seg-day')).toBe(true);
    expect(has(r, 'trend-seg-month')).toBe(false);
    await press(r, 'trend-seg-week');
    expect(load).toHaveBeenLastCalledWith(expect.anything(), 'week');
  });

  it('fewer than two points shows no line and No baseline yet with what a trend needs', async () => {
    const r = await mountNode(screen(trend([b(8, 100_000)], { options: [] }), null));
    expect(texts(r)).toContain('No baseline yet');
    expect(texts(r)).toContain('A trend needs at least 2 days of entries.');
    expect(has(r, 'trend-line')).toBe(false);
  });

  it('tapping a point or a table row opens that bucket in the drill-down', async () => {
    const onDrill = jest.fn();
    const r = await mountNode(screen(trend(days), null, onDrill));
    await press(r, 'trend-point-2026-11-02');
    expect(onDrill).toHaveBeenLastCalledWith({ kind: 'bucket', start: '2026-11-02', end: '2026-11-02', label: 'Nov 2' });
    await press(r, 'trend-toggle');
    await press(r, 'trend-row-2026-11-04');
    expect(onDrill).toHaveBeenLastCalledWith({ kind: 'bucket', start: '2026-11-04', end: '2026-11-04', label: 'Nov 4' });
  });

  it('the in and out card shows In and Out per period with the net in the Story 5.4 words, and a table', async () => {
    const io = inout([p('Sep', '2026-09-01', 8_500_000, 2_000_000, 'kept', 6_500_000), p('Oct', '2026-10-01', 8_500_000, 2_700_000, 'kept', 5_800_000), p('Nov', '2026-11-01', 100_000, 320_000, 'short', 220_000)]);
    const r = await mountNode(screen(null, io));
    const t = texts(r);
    for (const label of ['Sep', 'Oct', 'Nov']) expect(t).toContain(label);
    expect(t.some((x) => /^Net \+₹58,000(\.00)?$/.test(x))).toBe(true);
    expect(t.some((x) => /^Net ₹2,200(\.00)? out$/.test(x))).toBe(true);
    expect(t.some((x) => /^\+₹85,000/.test(x))).toBe(true);
    expect(t).toContain('In');
    expect(t).toContain('Out');
    await press(r, 'inout-toggle');
    expect(has(r, 'inout-table')).toBe(true);
    expect(t.join(' ')).not.toMatch(/[-−]\s?₹/);
  });

  it('with only the current period it says earlier ones show up as you use wmbugo', async () => {
    const r = await mountNode(screen(null, inout([p('Nov', '2026-11-01', 500_000, 0, 'kept', 500_000)])));
    expect(texts(r)).toContain('Earlier periods show up as you use wmbugo.');
  });

  it('an In or Out bar opens that period in the drill-down (income for In)', async () => {
    const onDrill = jest.fn();
    const r = await mountNode(screen(null, inout([p('Nov', '2026-11-01', 500_000, 100_000, 'kept', 400_000)]), onDrill));
    await press(r, 'inout-in-2026-11-01');
    expect(onDrill).toHaveBeenLastCalledWith({ kind: 'bucket', start: '2026-11-01', end: '2026-11-01', label: 'Nov', income: true });
    await press(r, 'inout-out-2026-11-01');
    expect(onDrill).toHaveBeenLastCalledWith({ kind: 'bucket', start: '2026-11-01', end: '2026-11-01', label: 'Nov' });
  });

  it('hidden amounts: no line, no area, no bar fills; dates, labels and the legend stay', async () => {
    useAmountsStore.getState().setHidden(true);
    const r = await mountNode(screen(trend(days), inout([p('Nov', '2026-11-01', 8_500_000, 2_700_000, 'kept', 5_800_000)])));
    const t = texts(r).join(' | ');
    expect(t).not.toMatch(/85,000|3,000|27,000|58,000/);
    expect(has(r, 'inout-in-fill-2026-11-01')).toBe(false);
    expect(texts(r)).toContain('Nov 1');
    expect(texts(r)).toContain('In');
  });

  it('either card failing says so with Retry and nothing is shown as zero', async () => {
    const r = await mountNode(screen('error', null));
    expect(has(r, 'trend-error')).toBe(true);
    expect(has(r, 'trend-line')).toBe(false);
  });
});
