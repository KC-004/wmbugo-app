import type { MerchantSpend } from '@wmbugo/core';
import { useAmountsStore } from '../../../shared/state/amountsHidden';
import type { MerchantsData } from '../insightsApi';
import { InsightsScreen } from '../InsightsScreen';
import { fakeInsightsApi, has, installInsightsHooks, mountNode, overview, press, texts } from '../insightsTestKit';
import { useInsightsStore } from '../insightsStore';
import { registerInsightsSection } from '../sectionRegistry';
import { whoGotIt } from './WhoGotIt';

jest.mock('../../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Kolkata' } }));
installInsightsHooks();

const echo = { start: '2026-11-01', end: '2026-11-30', endExclusive: '2026-12-01', label: '1–30 Nov', filters: {} };
const m = (key: string, name: string, spent: number, entries: number, back = 0): MerchantSpend => ({ key, name, displayMinor: spent, backMinor: back, entries, noMerchant: false });
const none = (spent: number, entries: number): MerchantSpend => ({ key: '', name: 'No merchant', displayMinor: spent, backMinor: 0, entries, noMerchant: true });

const data = (over: Partial<MerchantsData['merchants']> = {}, parts: string[] = []): MerchantsData => ({
  currency: 'INR',
  locale: 'en-IN',
  merchants: { scope: echo, ranked: [m('swiggy', 'Swiggy', 645_000, 14), m('amazon', 'Amazon', 300_000, 3)], noMerchant: none(180_000, 2), surplus: [], ...over },
  scopeParts: parts,
});

const screen = (d: MerchantsData | null | 'error', onDrill?: jest.Mock) => {
  registerInsightsSection(whoGotIt);
  const api = fakeInsightsApi({
    loadOverview: jest.fn(async () => overview()),
    loadMerchants: jest.fn(async () => {
      if (d === 'error') throw new Error('x');
      return d;
    }),
  });
  return <InsightsScreen api={api} nav={onDrill ? { onDrill } : {}} />;
};

describe('Who got it? (Story 7.6)', () => {
  it('lists the top merchants by amount, then No merchant, with the scope label first', async () => {
    const r = await mountNode(screen(data()));
    const t = texts(r);
    expect(t).toContain('Who got it?');
    expect(t).toContain('Top merchants · 1–30 Nov');
    expect(t.indexOf('Swiggy')).toBeLessThan(t.indexOf('Amazon'));
    expect(t.indexOf('Amazon')).toBeLessThan(t.indexOf('No merchant'));
    expect(t.some((x) => /^₹6,450(\.00)?$/.test(x))).toBe(true);
  });

  it('a refund-surplus merchant reads Amazon · ₹2,000 back with no minus sign', async () => {
    const r = await mountNode(screen(data({ surplus: [m('flipkart', 'Flipkart', 0, 1, 200_000)] })));
    expect(texts(r).some((x) => /^Flipkart · ₹2,000(\.00)? back$/.test(x))).toBe(true);
    expect(texts(r).join(' ')).not.toMatch(/[-−]\s?₹|[-−]\d/);
  });

  it('shows the top ten and offers the rest in place with See all N merchants', async () => {
    const many = Array.from({ length: 13 }, (_, i) => m(`k${i}`, `Shop ${i}`, 1_000_000 - i * 1000, 2));
    const r = await mountNode(screen(data({ ranked: many, noMerchant: null })));
    expect(has(r, 'who-chart-bar-k9')).toBe(true);
    expect(has(r, 'who-chart-bar-k10')).toBe(false);
    expect(texts(r)).toContain('See all 13 merchants');
    await press(r, 'who-see-all');
    expect(has(r, 'who-chart-bar-k12')).toBe(true);
    expect(texts(r)).toContain('Show fewer merchants');
  });

  it('tapping a merchant or No merchant opens its entries in the drill-down', async () => {
    const onDrill = jest.fn();
    const r = await mountNode(screen(data(), onDrill));
    await press(r, 'who-chart-bar-swiggy');
    expect(onDrill).toHaveBeenLastCalledWith({ kind: 'merchant', key: 'swiggy', name: 'Swiggy' });
    await press(r, 'who-chart-bar-__none__');
    expect(onDrill).toHaveBeenLastCalledWith({ kind: 'merchant', key: '', name: 'No merchant' });
  });

  it('View as table lists Merchant, Amount and Entries, each row one node', async () => {
    const r = await mountNode(screen(data()));
    await press(r, 'who-chart-toggle');
    expect(has(r, 'who-chart-table')).toBe(true);
    expect(texts(r)).toContain('Merchant');
    expect(texts(r)).toContain('Entries');
    expect(texts(r)).toContain('14 entries');
    const row = r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'who-chart-row-swiggy')[0]!;
    expect(row.props.accessibilityLabel).toMatch(/^Swiggy, .*14 entries$/);
  });

  it('a merchant filter shows just that merchant under its own scope label', async () => {
    useInsightsStore.getState().setFilters({ merchantKeys: ['swiggy'] });
    const r = await mountNode(screen(data({ ranked: [m('swiggy', 'Swiggy', 645_000, 14)], noMerchant: null }, ['Swiggy only'])));
    expect(texts(r)).toContain('Top merchants · Swiggy only');
    expect(has(r, 'who-chart-bar-amazon')).toBe(false);
  });

  it('nothing spent reads so with no chart', async () => {
    const r = await mountNode(screen(data({ ranked: [], noMerchant: null })));
    expect(texts(r)).toContain('Nothing spent in 1–30 Nov.');
    expect(has(r, 'who-chart')).toBe(false);
  });

  it('hidden amounts: no bar fills and amounts as dots, while merchant names and entry counts stay', async () => {
    useAmountsStore.getState().setHidden(true);
    const r = await mountNode(screen(data()));
    expect(texts(r).join(' ')).not.toMatch(/6,450|3,000|1,800/);
    expect(texts(r)).toContain('Swiggy');
    expect(has(r, 'who-chart-fill-swiggy')).toBe(false);
    await press(r, 'who-chart-toggle');
    expect(texts(r)).toContain('14 entries');
  });

  it('a failing load says so with Retry', async () => {
    const r = await mountNode(screen('error'));
    expect(has(r, 'who-error')).toBe(true);
    expect(has(r, 'who-chart')).toBe(false);
  });
});
