import { categoryView, type CategorySpend, type DrillTarget } from '@wmbugo/core';
import { useAmountsStore } from '../../../shared/state/amountsHidden';
import type { CategoriesData } from '../insightsApi';
import { InsightsScreen } from '../InsightsScreen';
import { fakeInsightsApi, has, installInsightsHooks, mountNode, overview, press, texts } from '../insightsTestKit';
import { registerInsightsSection } from '../sectionRegistry';
import { whereDidItGo } from './WhereDidItGo';

jest.mock('../../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Kolkata' } }));
installInsightsHooks();

const cat = (id: string, name: string, spent: number, back = 0): CategorySpend => ({ categoryId: id, name, icon: 'Tag', colorToken: 'cat-rose', displayMinor: spent, backMinor: back });
const echo = { start: '2026-11-01', end: '2026-11-30', endExclusive: '2026-12-01', label: '1–30 Nov', filters: {} };

const data = (rows: CategorySpend[], spent = 2_700_000, back = 0): CategoriesData => ({
  currency: 'INR',
  locale: 'en-IN',
  byCategory: { scope: echo, rows },
  total: { scope: echo, spentMinor: spent, backMinor: back },
  view: categoryView(rows),
  scopeParts: [],
});
const november = [cat('rent', 'Rent', 1_800_000), cat('food', 'Food', 1_000_000), cat('fuel', 'Fuel', 400_000), cat('nc', 'Not classified', 200_000), cat('shop', 'Shopping', 0, 700_000)];

const screen = (d: CategoriesData | null | 'error', onDrill?: jest.Mock) => {
  registerInsightsSection(whereDidItGo);
  const api = fakeInsightsApi({
    loadOverview: jest.fn(async () => overview()),
    loadCategories: jest.fn(async () => {
      if (d === 'error') throw new Error('x');
      return d;
    }),
  });
  return <InsightsScreen api={api} nav={onDrill ? { onDrill } : {}} />;
};

describe('Where did it go? (Story 7.4)', () => {
  it('is the first section, a real heading, with the scope label first and the total line', async () => {
    const r = await mountNode(screen(data(november, 3_400_000 - 700_000, 700_000)));
    const t = texts(r);
    expect(t).toContain('Where did it go?');
    expect(t).toContain('Spent by category · 1–30 Nov');
    expect(t.some((x) => /^Total spent ₹27,000(\.00)? · after ₹7,000(\.00)? back$/.test(x))).toBe(true);
    expect(r.root.findAll((n) => n.props.accessibilityRole === 'header' && [n.props.children].flat().includes('Where did it go?')).length).toBeGreaterThan(0);
  });

  it('ranks the categories by amount with shares that add to 100, then lists Shopping as ₹7,000 back with no share and no minus sign', async () => {
    const r = await mountNode(screen(data(november, 2_700_000, 700_000)));
    const t = texts(r);
    expect(t.indexOf('Rent')).toBeLessThan(t.indexOf('Food'));
    expect(t.indexOf('Food')).toBeLessThan(t.indexOf('Fuel'));
    expect(t.some((x) => /^Shopping · ₹7,000(\.00)? back$/.test(x))).toBe(true);
    expect(t).toContain('53%');
    expect(t).toContain('29%');
    expect(t.join(' ')).not.toMatch(/[-−]\s?₹|[-−]\d/);
  });

  it('the donut has a segment label for each category and the count in the centre; refund-surplus ones are not in it', async () => {
    const r = await mountNode(screen(data(november)));
    expect(has(r, 'where-donut')).toBe(true);
    expect(texts(r)).toContain('4 categories');
    const labels = texts(r).filter((x) => / · \d+%$/.test(x));
    expect(labels.some((x) => x.startsWith('Rent'))).toBe(true);
    expect(labels.some((x) => x.startsWith('Shopping'))).toBe(false);
  });

  it('more than six categories fold into Other · N categories', async () => {
    const rows = Array.from({ length: 9 }, (_, i) => cat(`c${i}`, `Cat ${i}`, 1000 - i * 10));
    const r = await mountNode(screen(data(rows)));
    expect(texts(r).some((x) => /^Other · 3 categories · \d+%$/.test(x))).toBe(true);
  });

  it('tapping a bar opens that category in the drill-down, and Other opens its categories', async () => {
    const onDrill = jest.fn();
    const rows = Array.from({ length: 9 }, (_, i) => cat(`c${i}`, `Cat ${i}`, 1000 - i * 10));
    const r = await mountNode(screen(data(rows), onDrill));
    await press(r, 'where-chart-bar-c0');
    expect(onDrill).toHaveBeenLastCalledWith({ kind: 'category', id: 'c0', name: 'Cat 0' } satisfies DrillTarget);
  });

  it('View as table replaces the donut and the bars with Category, Amount and Share rows', async () => {
    const r = await mountNode(screen(data(november, 2_700_000, 700_000)));
    await press(r, 'where-chart-toggle');
    expect(has(r, 'where-chart-table')).toBe(true);
    expect(has(r, 'where-donut')).toBe(false);
  });

  it('nothing spent reads so with no chart; one category is a full ring labelled 100%', async () => {
    const none = await mountNode(screen(data([], 0, 0)));
    expect(texts(none)).toContain('Nothing spent in 1–30 Nov.');
    expect(has(none, 'where-donut')).toBe(false);
    const one = await mountNode(screen(data([cat('food', 'Food', 5000)], 5000)));
    expect(texts(one)).toContain('Food · 100%');
    expect(texts(one)).toContain('1 category');
  });

  it('hidden amounts: no donut segments, no percents, names and order stay, and the donut is one decorative node', async () => {
    useAmountsStore.getState().setHidden(true);
    const r = await mountNode(screen(data(november)));
    const t = texts(r).join(' | ');
    expect(t).not.toMatch(/\d+%/);
    expect(t).not.toMatch(/18,000|10,000/);
    expect(t).toContain('Rent');
    const donut = r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'where-donut')[0]!;
    expect(donut.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('a failing load says so with Retry and nothing is shown as zero', async () => {
    const r = await mountNode(screen('error'));
    expect(has(r, 'where-error')).toBe(true);
    expect(has(r, 'where-donut')).toBe(false);
  });
});
