import { Share } from 'react-native';
import { act } from 'react-test-renderer';
import type { DrillDown, DrillTarget } from '@wmbugo/core';
import { useAmountsStore } from '../../shared/state/amountsHidden';
import { DrillScreen, drillTitle } from './DrillScreen';
import { activityQueryFor, shareCsvSaver, type DrillApi, type DrillData } from './drillApi';
import { DEFAULT_SELECTION } from './insightsApi';
import { has, installInsightsHooks, mountNode, press, settle, texts } from './insightsTestKit';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Kolkata' } }));
installInsightsHooks();

const echo = { start: '2026-11-01', end: '2026-11-30', endExclusive: '2026-12-01', label: '1–30 Nov', filters: {} };
const entry = (id: string, date: string, amount: number) => ({ id, localDate: date, type: 'expense' as const, merchant: 'Swiggy', categoryName: 'Food', categoryIcon: 'ForkKnife', categoryColor: 'cat-rose', accountName: 'HDFC', note: null, amountMinor: amount });
const drill = (over: Partial<DrillDown> = {}): DrillDown => ({
  target: { kind: 'spent' },
  mode: 'spending',
  scope: echo,
  spentMinor: 1_000_000,
  backMinor: 0,
  incomeMinor: 0,
  granularity: 'day',
  buckets: [{ start: '2026-11-03', end: '2026-11-03', label: 'Nov 3', spentMinor: 1_000_000, backMinor: 0 }],
  days: [{ date: '2026-11-03', spentMinor: 1_000_000, backMinor: 0, entries: [entry('t1', '2026-11-03', 1_000_000)] }],
  explanation: { formula: 'spent', timeframe: '1–30 Nov', entryCount: 1, baseline: null },
  ...over,
});
const data = (d = drill(), over: Partial<DrillData> = {}): DrillData => ({ drill: d, currency: 'INR', locale: 'en-IN', exponent: 2, today: '2026-11-08', timezoneId: 'Asia/Kolkata', filtersText: '', scopeParts: [], ...over });
const api = (d: DrillData): DrillApi => ({ loadDrill: jest.fn(async () => d) });
const show = (d: DrillData, t: DrillTarget = { kind: 'spent' }, saver?: { save: jest.Mock }) => <DrillScreen selection={DEFAULT_SELECTION} target={t} api={api(d)} {...(saver ? { saver } : {})} onBack={() => undefined} onOpenEntry={() => undefined} onSeeInActivity={() => undefined} />;

describe('See in Activity carries every filter of the drill-down (review, Story 7.2)', () => {
  it('a category, the Other segment, a merchant, a bucket and the totals each ask Activity for exactly their slice', () => {
    const nov = { fromDate: '2026-11-01', toDate: '2026-11-30' };
    expect(activityQueryFor(data(), undefined)).toEqual({ ...nov, types: ['expense', 'refund'] });
    expect(activityQueryFor(data(), ['a', 'b'])).toEqual({ ...nov, categoryIds: ['a', 'b'], types: ['expense', 'refund'] });
    expect(activityQueryFor(data(drill({ mode: 'income', spentMinor: 0, incomeMinor: 5 })), undefined)).toEqual({ ...nov, types: ['income'] });
    expect(activityQueryFor(data(drill(), { descriptions: ['Swiggy', 'SWIGGY*BLR 8821', null] }), undefined)).toEqual({ ...nov, descriptions: ['Swiggy', 'SWIGGY*BLR 8821', null], types: ['expense', 'refund'] });
    const filtered = drill({ scope: { ...echo, start: '2026-11-05', end: '2026-11-05', filters: { accountIds: ['a1'], categoryIds: ['c1'], tags: ['trip'], sources: ['csv'], types: ['refund'] } } });
    expect(activityQueryFor(data(filtered), undefined)).toEqual({ fromDate: '2026-11-05', toDate: '2026-11-05', accountIds: ['a1'], categoryIds: ['c1'], tags: ['trip'], sources: ['csv'], types: ['refund'] });
  });

  it('a Type filter is never widened back to the whole kind', () => {
    const f = drill({ scope: { ...echo, filters: { types: ['income'] } } });
    expect(activityQueryFor(data(f), undefined).types).toEqual([]);
  });
});

describe('the drill-down screen (review)', () => {
  it('the title says In for the money-in side of a bucket, so the two drills of one bucket differ', () => {
    expect(drillTitle({ kind: 'bucket', start: '2026-11-01', end: '2026-11-30', label: 'Nov' })).toBe('Nov');
    expect(drillTitle({ kind: 'bucket', start: '2026-11-01', end: '2026-11-30', label: 'Nov', income: true })).toBe('Nov · In');
  });

  it('turning Hide amounts on masks every amount at once, with no reload', async () => {
    const d = api(data(drill({ explanation: { formula: 'spent', timeframe: '1–30 Nov', entryCount: 1, baseline: { kind: 'amount', label: 'Oct 1–8', previousMinor: 1_250_000 } } })));
    const r = await mountNode(<DrillScreen selection={DEFAULT_SELECTION} target={{ kind: 'spent' }} api={d} onBack={() => undefined} onOpenEntry={() => undefined} onSeeInActivity={() => undefined} />);
    expect(texts(r).join(' ')).toMatch(/12,500/);
    await act(async () => useAmountsStore.getState().setHidden(true));
    await settle();
    expect(texts(r).join(' ')).not.toMatch(/12,500|10,000/);
    expect((d.loadDrill as jest.Mock).mock.calls.length).toBe(1);
  });

  it('an empty drill-down offers no export, and the export button ignores a second tap while one is open', async () => {
    const empty = await mountNode(show(data(drill({ days: [], buckets: [], spentMinor: 0, explanation: { formula: 'spent', timeframe: '1–30 Nov', entryCount: 0, baseline: null } }))));
    expect(has(empty, 'drill-export')).toBe(false);
    let release: (v: 'saved') => void = () => undefined;
    const save = jest.fn(() => new Promise<'saved'>((res) => (release = res)));
    const r = await mountNode(show(data(), { kind: 'spent' }, { save }));
    await act(async () => {
      const b = r.root.findAll((n) => n.props.testID === 'drill-export' && typeof n.props.onPress === 'function')[0]!;
      b.props.onPress();
      b.props.onPress();
    });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => release('saved'));
  });

  it('an amount that cannot be written makes no file and says so', async () => {
    const save = jest.fn(async () => 'saved' as const);
    const r = await mountNode(show(data(drill(), { exponent: -1 }), { kind: 'spent' }, { save }));
    await press(r, 'drill-export');
    expect(save).not.toHaveBeenCalled();
    expect(texts(r)).toContain("Couldn't export that. Nothing was changed.");
  });
});

describe('the share-sheet saver (review)', () => {
  it('maps the share sheet’s answer: shared is saved, dismissed is cancelled, a throw is failed', async () => {
    const spy = jest.spyOn(Share, 'share');
    spy.mockResolvedValueOnce({ action: Share.sharedAction, activityType: undefined });
    expect(await shareCsvSaver.save('f.csv', 'a,b')).toBe('saved');
    expect(spy).toHaveBeenLastCalledWith({ title: 'f.csv', message: 'a,b' });
    spy.mockResolvedValueOnce({ action: Share.dismissedAction, activityType: undefined });
    expect(await shareCsvSaver.save('f.csv', 'a,b')).toBe('cancelled');
    spy.mockRejectedValueOnce(new Error('x'));
    expect(await shareCsvSaver.save('f.csv', 'a,b')).toBe('failed');
  });
});

