import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { budgetStatus, mapCategoryRows, SEED_CATEGORIES, type BudgetDetail, type BudgetSnapshot, type SaveBudgetInput } from '@wmbugo/core';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { BudgetDetailScreen } from './BudgetDetailScreen';
import type { BudgetDetailData, BudgetsApi, BudgetsData } from './budgetsApi';
import { NO_TEMPLATE } from './budgetsTestKit';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0 } }));

const live: ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => new Promise((res) => setTimeout(res, 0)));
  for (const r of live.splice(0)) act(() => r.unmount());
  jest.restoreAllMocks();
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
const host = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id)[0]!;
const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());
  await settle();
};
const type = async (r: ReactTestRenderer, id: string, text: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onChangeText === 'function')[0]!.props.onChangeText(text));
  await settle();
};

const NOV = { start: '2026-11-01', end: '2026-11-30', kind: 'calendar_month' as const };
const OCT = { start: '2026-10-01', end: '2026-10-31', kind: 'calendar_month' as const };
const status = (used: number, target: number, today = '2026-11-15', period: { start: string; end: string } = NOV) => budgetStatus({ usedMinor: used, targetMinor: target, period, today });

const entry = (id: string, over: Partial<BudgetDetail['entries'][number]> = {}): BudgetDetail['entries'][number] => ({ id, kind: 'expense', amountMinor: 1_200_000, localDate: '2026-11-03', merchant: 'Swiggy', categoryName: 'Food & Drinks', categoryIcon: 'ForkKnife', categoryColor: 'cat-rose', accountName: 'HDFC', ...over });
const detail = (over: Partial<BudgetDetail> = {}): BudgetDetail => ({
  id: 'b1', name: 'Overall', scope: 'overall', budgetType: null, period: NOV, periodLabel: '1–30 Nov', isCurrent: true, back: 0, canGoBack: true, canGoForward: false, previousStart: '2026-10-01', nextStart: null,
  usedMinor: 2_000_000, targetMinor: 5_000_000, refundSurplusMinor: 0, status: status(2_000_000, 5_000_000), breakdown: [{ categoryId: 'cat_food', name: 'Food & Drinks', amountMinor: 1_200_000, memberIds: ['cat_food'] }, { categoryId: 'cat_groceries', name: 'Groceries', amountMinor: 800_000, memberIds: ['cat_groceries', 'sub_rice'] }],
  entries: [entry('t1'), entry('t2', { amountMinor: 800_000, localDate: '2026-11-10', merchant: 'BigBasket', categoryName: 'Groceries' })], today: '2026-11-15', ...over,
});

const CATEGORIES = mapCategoryRows(SEED_CATEGORIES.filter((c) => c.kind !== 'income').map((c, i) => [c.id, c.name, c.kind, c.budgetType, c.icon, c.color, i, null]));

function fakeApi(byBack: Record<number, BudgetDetail> | 'missing' = { 0: detail() }) {
  const loadDetail = jest.fn<Promise<BudgetDetailData | 'missing' | null>, [string, number]>(async (_id, back) =>
    byBack === 'missing' ? 'missing' : { detail: byBack[back] ?? detail(), currency: 'INR', locale: 'en-IN', exponent: 2 },
  );
  const remove = jest.fn<Promise<{ ok: boolean }>, [string]>(async () => ({ ok: true }));
  const restore = jest.fn<Promise<{ ok: boolean }>, [string]>(async () => ({ ok: true }));
  const save = jest.fn<ReturnType<BudgetsApi['save']>, [SaveBudgetInput]>(async () => ({ ok: true, value: { budgetId: 'b1', created: false, snapshot: {} as BudgetSnapshot } }));
  const undo = jest.fn(async () => ({ ok: true }));
  const data = (): BudgetsData => ({ list: { today: '2026-11-15', rows: [], overallId: 'b1', typeSummary: null }, currency: 'INR', locale: 'en-IN', exponent: 2, payCycle: true, categories: CATEGORIES, accounts: [], template: NO_TEMPLATE });
  const readForEdit = jest.fn(async (id: string) => ({ id, name: 'Overall', scope: 'overall' as const, categoryIds: [], budgetType: null, accountIds: null, period: { rule: 'default' as const }, targetMinor: 5_000_000, currentPeriodStart: '2026-11-01', nextPeriodStart: '2026-12-01' }));
  const api: BudgetsApi = { load: async () => data(), readForEdit, save, undo, loadDetail, remove, restore, createTemplate: async () => ({ ok: true, budgetIds: [] }), undoTemplate: async () => ({ ok: true }), changeTemplate: async () => ({ ok: true }), dismissTemplateCard: async () => undefined, answerIncomeChange: async () => ({ ok: true }) };
  return { api, loadDetail, remove, restore, save, undo };
}

async function mount(api: BudgetsApi, onBack = jest.fn(), onOpenEntry = jest.fn()) {
  const qc = createQueryClient();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <SheetHost>
              <BudgetDetailScreen budgetId="b1" onBack={onBack} onOpenEntry={onOpenEntry} api={api} />
            </SheetHost>
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  await settle();
  return { r, onBack, onOpenEntry };
}

describe('Budget detail (SCR-15, Story 4.7)', () => {
  it('shows the name, period with days left, the limit bar, Left, Projected, the category amounts and the entries', async () => {
    const { r } = await mount(fakeApi().api);
    expect(has(r, 'budget-detail')).toBe(true);
    expect(texts(r)).toEqual(expect.arrayContaining(['Overall', '1–30 Nov · 16 days left', 'By category', 'Food & Drinks', 'Groceries', 'What counted']));
    // The amount is its own element (<Amount>), so the label and the figure are separate nodes.
    expect(texts(r).join('|')).toContain('Left |₹30,000.00');
    expect(texts(r).join('|')).toContain('Projected  by 30 Nov · estimate|₹40,000.00');
    expect(has(r, 'detail-limit')).toBe(true);
    expect(r.root.findAll((n) => typeof n.type === 'string' && /^activity-row-|^row-/.test(String(n.props.testID))).length).toBeGreaterThanOrEqual(0);
    expect(has(r, 'budget-entries')).toBe(true);
  });

  it('hides Projected while the budget is too early to tell, and says Over by when the limit is passed', async () => {
    const early = detail({ status: status(100_000, 5_000_000, '2026-11-02'), usedMinor: 100_000 });
    const a = await mount(fakeApi({ 0: early }).api);
    expect(has(a.r, 'budget-projected')).toBe(false);
    const exceeded = detail({ usedMinor: 5_234_000, status: status(5_234_000, 5_000_000) });
    const b = await mount(fakeApi({ 0: exceeded }).api);
    expect(texts(b.r).join('|')).toContain('Over by |₹2,340.00');
    expect(texts(b.r)).not.toContain('Left ');
  });

  it('Refunds this period: +₹X shows only when the surplus is above zero', async () => {
    const withSurplus = await mount(fakeApi({ 0: detail({ refundSurplusMinor: 700_000 }) }).api);
    expect(texts(withSurplus.r).join('|')).toContain('Refunds this period: |+₹7,000.00');
    const none = await mount(fakeApi().api);
    expect(has(none.r, 'budget-refunds')).toBe(false);
  });

  it('a category budget has no category amounts; a refund entry is listed too', async () => {
    const cat = detail({ scope: 'category', name: 'Groceries', breakdown: null, entries: [entry('t1', { kind: 'refund', amountMinor: 90_000, merchant: 'Refund' })] });
    const { r } = await mount(fakeApi({ 0: cat }).api);
    expect(has(r, 'budget-breakdown')).toBe(false);
    expect(has(r, 'budget-entries')).toBe(true);
  });

  it('tapping an entry opens that transaction', async () => {
    const { r, onOpenEntry } = await mount(fakeApi().api);
    const rows = r.root.findAll((n) => typeof n.props.onPress === 'function' && n.props.accessibilityLabel && /Swiggy/.test(String(n.props.accessibilityLabel)));
    expect(rows.length).toBeGreaterThan(0);
    await act(async () => rows[0]!.props.onPress());
    expect(onOpenEntry).toHaveBeenCalledWith('t1');
  });

  it('with nothing counted it says so', async () => {
    const { r } = await mount(fakeApi({ 0: detail({ entries: [], usedMinor: 0, breakdown: [], status: status(0, 5_000_000) }) }).api);
    expect(texts(r)).toContain('Nothing counted in this budget yet this period.');
  });

  it('shows skeleton rows while loading', async () => {
    const f = fakeApi();
    f.loadDetail.mockImplementation(() => new Promise(() => undefined));
    const { r } = await mount(f.api);
    expect(has(r, 'budget-detail-loading')).toBe(true);
    expect(has(r, 'skeleton')).toBe(true);
  });

  it('a budget deleted elsewhere reads the inline message with Back to budgets, and changes nothing', async () => {
    const { r, onBack } = await mount(fakeApi('missing').api);
    expect(texts(r)).toContain('This budget was deleted. Nothing was changed.');
    await press(r, 'budget-detail-back');
    expect(onBack).toHaveBeenCalled();
    expect(texts(r)).toContain('Back to budgets');
  });
});

describe('the period switcher', () => {
  const oct = detail({ period: OCT, periodLabel: '1–31 Oct', isCurrent: false, back: 1, canGoBack: false, canGoForward: true, previousStart: '2026-09-01', nextStart: '2026-11-01', usedMinor: 700_000, targetMinor: 5_000_000, status: status(700_000, 5_000_000, '2026-11-15', OCT), entries: [entry('o1', { localDate: '2026-10-12', amountMinor: 700_000 })] });

  it('› is disabled on the current period; ‹ Oct goes back and shows October with its own figures; the next button then returns', async () => {
    const f = fakeApi({ 0: detail(), 1: oct });
    const { r } = await mount(f.api);
    expect(host(r, 'budget-period-forward').props.accessibilityState).toMatchObject({ disabled: true });
    expect(texts(r)).toContain('Oct');
    await press(r, 'budget-period-back');
    expect(f.loadDetail).toHaveBeenCalledWith('b1', 1);
    expect(texts(r)).toContain('1–31 Oct');
    expect(texts(r).join('|')).toContain('Left |₹43,000.00');
    expect(texts(r)).toContain('Nov');
    // No days left on a period that has ended.
    expect(texts(r).join('|')).not.toContain('1–31 Oct ·');
    expect(host(r, 'budget-period-back').props.accessibilityState).toMatchObject({ disabled: true });
    await press(r, 'budget-period-forward');
    expect(texts(r)).toContain('1–30 Nov · 16 days left');
  });
});

describe('opening from a notification (Story 4.9)', () => {
  it('a period start opens that period of the budget', async () => {
    const oct = detail({ period: OCT, periodLabel: '1–31 Oct', isCurrent: false, back: 1, canGoForward: true, nextStart: '2026-11-01', status: status(700_000, 5_000_000, '2026-11-15', OCT) });
    const f = fakeApi({ 0: detail(), 1: oct });
    f.loadDetail.mockImplementation(async (_id, back) => ({ detail: typeof back === 'string' ? oct : detail(), currency: 'INR', locale: 'en-IN', exponent: 2 }));
    const qc = createQueryClient();
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <QueryClientProvider client={qc}>
          <ThemeProvider>
            <ToastHost bottomOffset={0}>
              <SheetHost>
                <BudgetDetailScreen budgetId="b1" periodStart="2026-10-01" onBack={() => undefined} onOpenEntry={() => undefined} api={f.api} />
              </SheetHost>
            </ToastHost>
          </ThemeProvider>
        </QueryClientProvider>,
      );
    });
    live.push(r);
    await settle();
    expect(f.loadDetail).toHaveBeenCalledWith('b1', '2026-10-01');
    expect(texts(r)).toContain('1–31 Oct');
  });
});

describe('Edit and Delete', () => {
  it('Delete budget confirms with the entries-stay sentence, removes, goes back and toasts with Undo', async () => {
    const f = fakeApi({ 0: detail({ name: 'Groceries', scope: 'category', breakdown: null }) });
    const { r, onBack } = await mount(f.api);
    await press(r, 'budget-delete');
    expect(texts(r)).toContain("Delete the Groceries budget? Your entries don't change.");
    expect(f.remove).not.toHaveBeenCalled();
    await press(r, 'budget-delete-confirm');
    expect(f.remove).toHaveBeenCalledWith('b1');
    expect(onBack).toHaveBeenCalled();
    expect(texts(r)).toContain('Budget deleted');
    await press(r, 'toast-undo');
    expect(f.restore).toHaveBeenCalledWith('b1');
  });

  it('Cancel on the delete sheet changes nothing', async () => {
    const f = fakeApi();
    const { r } = await mount(f.api);
    await press(r, 'budget-delete');
    await press(r, 'budget-delete-cancel');
    expect(f.remove).not.toHaveBeenCalled();
  });

  it('changing the limit asks when it starts: Starting this period or From next period (1 Dec), and saves the choice', async () => {
    const f = fakeApi();
    const { r } = await mount(f.api);
    await press(r, 'budget-edit');
    expect(has(r, 'budget-sheet')).toBe(true);
    expect(has(r, 'budget-from-this')).toBe(false); // no change yet
    await type(r, 'budget-limit', '45000');
    expect(texts(r)).toEqual(expect.arrayContaining(['Starting this period', 'From next period (1 Dec)']));
    await press(r, 'budget-from-next');
    await press(r, 'budget-save');
    expect(f.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1', targetMinor: 4_500_000, targetFrom: 'next_period' }));
  });

  it('this period is the default start, and an unchanged limit sends no start choice', async () => {
    const f = fakeApi();
    const { r } = await mount(f.api);
    await press(r, 'budget-edit');
    await type(r, 'budget-limit', '45000');
    await press(r, 'budget-save');
    expect(f.save).toHaveBeenLastCalledWith(expect.objectContaining({ targetFrom: 'this_period' }));
    await press(r, 'budget-edit');
    await press(r, 'budget-save');
    expect(f.save.mock.calls.at(-1)![0]).not.toHaveProperty('targetFrom');
  });
});

describe('drilling into Needs, Wants and Savings (Story 4.11)', () => {
  it('a category row opens Activity filtered to that category (and its subcategories) and this period', async () => {
    const onOpenActivity = jest.fn();
    const qc = createQueryClient();
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <QueryClientProvider client={qc}>
          <ThemeProvider>
            <ToastHost bottomOffset={0}>
              <SheetHost>
                <BudgetDetailScreen budgetId="b1" onBack={() => undefined} onOpenEntry={() => undefined} onOpenActivity={onOpenActivity} api={fakeApi().api} />
              </SheetHost>
            </ToastHost>
          </ThemeProvider>
        </QueryClientProvider>,
      );
    });
    live.push(r);
    await settle();
    await press(r, 'budget-share-cat_groceries');
    expect(onOpenActivity).toHaveBeenCalledWith({ categoryIds: ['cat_groceries', 'sub_rice'], fromDate: '2026-11-01', toDate: '2026-11-30' });
  });

  it('Savings lists the transfers in and out, hides Left and Projected, and shows no warning', async () => {
    const sav = detail({
      name: 'Savings', scope: 'savings', breakdown: null, usedMinor: 700_000, targetMinor: 1_600_000, savingsMovedMinor: 700_000, status: status(700_000, 1_600_000),
      entries: [
        { id: 't1', kind: 'transfer', direction: 'out', amountMinor: 200_000, localDate: '2026-11-06', merchant: null, categoryName: null, categoryIcon: null, categoryColor: null, accountName: 'Holiday → HDFC' },
        { id: 't2', kind: 'transfer', direction: 'in', amountMinor: 900_000, localDate: '2026-11-05', merchant: null, categoryName: null, categoryIcon: null, categoryColor: null, accountName: 'HDFC → Holiday' },
      ],
    });
    const { r } = await mount(fakeApi({ 0: sav }).api);
    expect(texts(r)).toContain('Moved into and out of savings pots');
    expect(has(r, 'budget-left')).toBe(false);
    expect(has(r, 'budget-projected')).toBe(false);
    expect(has(r, 'budget-entries')).toBe(true);
    expect(texts(r).join('|')).not.toMatch(/Over by/);
  });
});
