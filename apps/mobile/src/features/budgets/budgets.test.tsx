import { moneyLeaks } from '../../shared/moneyLeaks.testkit';
import { useAmountsStore } from '../../shared/state/amountsHidden';
import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { budgetStatus, mapCategoryRows, SEED_CATEGORIES, type BudgetListRow, type BudgetSnapshot, type SaveBudgetInput, type TemplateState, type TemplateTargets } from '@wmbugo/core';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { useUiStore } from '../../shared/state/uiStore';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { BudgetsScreen } from './BudgetsScreen';
import { barGeometry, limitBarLabel, LimitBar, OVERFLOW_CAP, savingsLabel, savingsStatusLine, statusLine } from '../../shared/ui/LimitBar';
import type { BudgetsApi, BudgetsData, SaveBudgetOutcome } from './budgetsApi';
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
const host = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id)[0]!;
const has = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id).length > 0;
const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());
  await settle();
};
const type = async (r: ReactTestRenderer, id: string, text: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onChangeText === 'function')[0]!.props.onChangeText(text));
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

const NOV = { start: '2026-11-01', end: '2026-11-30' };
const status = (used: number, target: number, today = '2026-11-12') => budgetStatus({ usedMinor: used, targetMinor: target, period: NOV, today });
const INR = 'INR' as const;

describe('limit bar geometry (UX-DR25)', () => {
  it('under the limit the fill is the share used and the tick is at the end', () => {
    expect(barGeometry(200_000, 400_000)).toEqual({ fill: 0.5, overflow: 0, tick: 1 });
    expect(barGeometry(0, 400_000)).toEqual({ fill: 0, overflow: 0, tick: 1 });
  });

  it('over the limit the overflow grows but is capped at 20% of the track, and the tick moves in', () => {
    const g = barGeometry(500_000, 400_000); // 25% over: capped at 20%
    expect(g.overflow + g.fill).toBeCloseTo(1);
    expect(g.overflow / (g.fill + g.overflow)).toBeCloseTo(OVERFLOW_CAP / (1 + OVERFLOW_CAP));
    expect(g.tick).toBeCloseTo(g.fill);
    const small = barGeometry(420_000, 400_000); // 5% over: not capped
    expect(small.overflow).toBeCloseTo(0.05 / 1.05);
    expect(barGeometry(1, 0).overflow).toBeGreaterThan(0);
  });
});

describe('limit bar status lines (no minus sign anywhere)', () => {
  it('on track, nearing, exceeded and too early', () => {
    expect(statusLine(status(100_000, 600_000), INR, 'en-IN', false)).toEqual({ text: '₹5,000.00 left · 19 days left', warning: false });
    expect(statusLine(status(3_800_000, 5_000_000), INR, 'en-IN', false)).toEqual({ text: '76% used', warning: false });
    expect(statusLine(status(5_074_000, 5_000_000), INR, 'en-IN', false)).toEqual({ text: 'Over by ₹740.00', warning: true });
    expect(statusLine(status(10_000, 600_000, '2026-11-02'), INR, 'en-IN', false)).toEqual({ text: 'Too early to tell', warning: false });
  });

  it('hidden keeps the day text and masks every amount: Over by ₹ ••••', () => {
    expect(statusLine(status(5_074_000, 5_000_000), INR, 'en-IN', true).text).toBe('Over by ₹ ••••');
    expect(statusLine(status(100_000, 600_000), INR, 'en-IN', true).text).toBe('₹ •••• left · 19 days left');
    expect(statusLine(status(3_800_000, 5_000_000), INR, 'en-IN', true).text).toBe('19 days left');
  });

  it('never contains a minus sign', () => {
    for (const s of [status(0, 600_000), status(900_000, 600_000), status(500_000, 600_000), status(5, 0)]) {
      expect(statusLine(s, INR, 'en-IN', false).text).not.toMatch(/[-−–]/);
    }
  });

  it('TalkBack reads one sentence per row from the figures, never the bar', () => {
    expect(limitBarLabel('Groceries', status(3_400_000, 4_000_000), INR, 'en-IN', false)).toBe('Groceries, 34,000 rupees of 40,000 rupees, 85% used, 19 days left');
    expect(limitBarLabel('Groceries', status(3_400_000, 4_000_000), INR, 'en-IN', true)).toBe('Groceries, 19 days left');
  });
});

describe('LimitBar states', () => {
  const bar = (over: Partial<Parameters<typeof LimitBar>[0]>) => <LimitBar testID="lb" name="Groceries" status={status(340_000, 600_000)} currency={INR} locale="en-IN" {...over} />;

  it('under: a fill and a tick, the amounts on the right', async () => {
    const r = await mountNode(bar({}));
    expect(has(r, 'lb-fill')).toBe(true);
    expect(has(r, 'lb-overflow')).toBe(false);
    expect(texts(r)).toContain('₹3,400.00 of ₹6,000.00');
  });

  it('80%: nearing reads the percentage', async () => {
    const r = await mountNode(bar({ status: status(4_800_000, 6_000_000) }));
    expect(texts(r)).toContain('80% used');
  });

  it('over: the overflow is drawn and the status is a warning with the amount over', async () => {
    const r = await mountNode(bar({ status: status(5_074_000, 5_000_000) }));
    expect(has(r, 'lb-overflow')).toBe(true);
    expect(texts(r)).toContain('Over by ₹740.00');
  });

  it('hidden: no fill, no percentage, no amounts, the track and the day text stay', async () => {
    const r = await mountNode(bar({ hidden: true, status: status(3_800_000, 5_000_000) }));
    expect(has(r, 'lb-track')).toBe(true);
    expect(has(r, 'lb-fill')).toBe(false);
    expect(texts(r).join(' ')).not.toMatch(/\d+%|3,800|5,000/);
    expect(texts(r)).toContain('19 days left');
    expect(host(r, 'lb').props.accessibilityLabel).toBe('Groceries, 19 days left');
  });

  it('due-soon: a bill row adds Due in 2 days next to the status', async () => {
    const r = await mountNode(bar({ dueText: 'Due in 2 days' }));
    expect(texts(r)).toContain(' · Due in 2 days');
    expect(host(r, 'lb').props.accessibilityLabel).toContain('Due in 2 days');
  });

  it('at 320dp and large text the name and amounts wrap, never truncate (no numberOfLines on them)', async () => {
    const r = await mountNode(bar({ name: 'Groceries and household supplies' }));
    const wrapped = r.root.findAll((n) => n.type === Text && n.props.numberOfLines !== undefined);
    expect(wrapped).toHaveLength(0);
  });
});

// ---- The list and the editor -----------------------------------------------------------------------------------------

const CATEGORIES = mapCategoryRows(SEED_CATEGORIES.filter((c) => c.kind !== 'income').map((c, i) => [c.id, c.name, c.kind, c.budgetType, c.icon, c.color, i, null]));
const row = (over: Partial<BudgetListRow> & { id: string; name: string }): BudgetListRow => ({
  group: 'categories', scope: 'category', budgetType: null, period: { ...NOV, kind: 'calendar_month' }, periodLabel: '1–30 Nov', usedMinor: 340_000, targetMinor: 600_000, refundSurplusMinor: 0, status: status(340_000, 600_000), overlapsOverall: false, ...over,
});

function fakeApi(rows: BudgetListRow[] = [], opts: { payCycle?: boolean; save?: BudgetsApi['save']; template?: Partial<TemplateState>; typeSummary?: BudgetsData['list']['typeSummary'] } = {}) {
  const state = { rows };
  const data = (): BudgetsData => ({
    list: { today: '2026-11-12', rows: state.rows, overallId: state.rows.find((r) => r.group === 'overall')?.id ?? null, typeSummary: opts.typeSummary ?? null },
    currency: INR, locale: 'en-IN', exponent: 2, payCycle: opts.payCycle ?? true, categories: CATEGORIES,
    accounts: [{ id: 'a1', name: 'HDFC' }, { id: 'a2', name: 'Cash' }],
    template: { ...NO_TEMPLATE, ...(opts.template ?? {}) },
  });
  const save = jest.fn<ReturnType<BudgetsApi['save']>, [SaveBudgetInput]>(opts.save ?? (async (input) => {
    state.rows = [...state.rows, row({ id: `b${state.rows.length + 1}`, name: input.scope === 'overall' ? 'Overall' : 'Groceries', group: input.scope === 'overall' ? 'overall' : 'categories', scope: input.scope })];
    return { ok: true, value: { budgetId: 'new', created: true, snapshot: {} as BudgetSnapshot } };
  }));
  const undo = jest.fn(async () => ({ ok: true }));
  const readForEdit = jest.fn(async (id: string) => ({ id, scope: 'overall' as const, categoryIds: [], budgetType: null, accountIds: null, period: { rule: 'default' as const }, targetMinor: 5_000_000, currentPeriodStart: '2026-11-01', nextPeriodStart: '2026-12-01' }));
  const createTemplate = jest.fn<ReturnType<BudgetsApi['createTemplate']>, [number, TemplateTargets?]>(async () => ({ ok: true, budgetIds: ['n', 'w', 's'] }));
  const undoTemplate = jest.fn(async () => ({ ok: true }));
  const changeTemplate = jest.fn<Promise<{ ok: boolean; code?: string }>, [TemplateTargets]>(async () => ({ ok: true }));
  const dismissTemplateCard = jest.fn(async () => undefined);
  const answerIncomeChange = jest.fn<Promise<{ ok: boolean }>, [boolean, { newIncomeMinor: number; periodStart: string }]>(async () => ({ ok: true }));
  const api: BudgetsApi = { load: async () => data(), readForEdit, save, undo, loadDetail: async () => null, remove: async () => ({ ok: true }), restore: async () => ({ ok: true }), createTemplate, undoTemplate, changeTemplate, dismissTemplateCard, answerIncomeChange };
  return { api, save, undo, readForEdit, state, createTemplate, undoTemplate, changeTemplate, dismissTemplateCard, answerIncomeChange };
}

describe('Budgets list (SCR-14, Story 4.6)', () => {
  it('with no budgets: the empty state with Add budget and Use 50/30/20', async () => {
    const f = fakeApi();
    const r = await mountNode(<BudgetsScreen api={f.api} />);
    expect(texts(r)).toContain('No budgets yet. Set one limit for this period.');
    expect(has(r, 'budgets-add')).toBe(true);
    expect(has(r, 'budgets-use-503020')).toBe(true);
  });

  it('groups Overall, 50/30/20 and Categories, labels each period and flags a category budget that overlaps the overall one', async () => {
    const f = fakeApi([
      row({ id: 'o', name: 'Overall', group: 'overall', scope: 'overall' }),
      row({ id: 'g', name: 'Groceries', overlapsOverall: true }),
      row({ id: 'w', name: 'Food & Drinks', periodLabel: 'Weekly · 9–15 Nov' }),
      row({ id: 'n', name: 'Needs', group: '50_30_20', scope: 'budget_type' }),
    ]);
    const r = await mountNode(<BudgetsScreen api={f.api} />);
    const groups = r.root.findAll((n) => typeof n.type === 'string' && /^budgets-group-/.test(String(n.props.testID))).map((n) => n.props.testID);
    expect(groups).toEqual(['budgets-group-overall', 'budgets-group-50_30_20', 'budgets-group-categories']);
    const t = texts(r);
    expect(t).toEqual(expect.arrayContaining(['Overall', '50/30/20', 'Categories', '1–30 Nov', 'Weekly · 9–15 Nov']));
    expect(t.filter((x) => x === 'Also counted in your overall budget')).toHaveLength(1);
    // Never a total that adds groups together.
    expect(t.join(' ')).not.toMatch(/total/i);
  });

  it('the editor offers For, Only these accounts, Period, Limit and Alert me at with 75%, 90% and 100% preselected', async () => {
    const f = fakeApi();
    const r = await mountNode(<BudgetsScreen api={f.api} />);
    await press(r, 'budgets-add');
    expect(has(r, 'budget-sheet')).toBe(true);
    const t = texts(r);
    expect(t).toEqual(expect.arrayContaining(['For', 'Everything', 'Some categories', 'Only these accounts', 'Period', 'Each pay cycle', 'Monthly', 'Weekly', 'Custom dates', 'Limit', 'Alert me at', '50%', '75%', '80%', '90%', '100%']));
    const selected = (id: string) => host(r, id).props.accessibilityState?.selected;
    expect([50, 75, 80, 90, 100].map((l) => selected(`budget-alert-${l}`))).toEqual([false, true, false, true, true]);
  });

  it("Home's Set a limit opens the editor once with Everything chosen", async () => {
    useUiStore.getState().requestBudgetEditor();
    const r = await mountNode(<BudgetsScreen api={fakeApi().api} />);
    expect(has(r, 'budget-sheet')).toBe(true);
    expect(host(r, 'budget-for-overall').props.accessibilityState?.selected).toBe(true);
    expect(useUiStore.getState().pendingBudgetEditor).toBe(false);
  });

  it("Home's Set a limit opens the existing overall budget instead of a second one", async () => {
    useUiStore.getState().requestBudgetEditor();
    const f = fakeApi([row({ id: 'o', name: 'Overall', group: 'overall', scope: 'overall' })]);
    await mountNode(<BudgetsScreen api={f.api} />);
    expect(f.readForEdit).toHaveBeenCalledWith('o');
    expect(useUiStore.getState().pendingBudgetEditor).toBe(false);
  });

  it("a failed load clears Home's Set a limit request instead of leaving it for a later visit", async () => {
    useUiStore.getState().requestBudgetEditor();
    const f = fakeApi();
    f.api.load = async () => {
      throw new Error('boom');
    };
    const r = await mountNode(<BudgetsScreen api={f.api} />);
    expect(has(r, 'budget-sheet')).toBe(false);
    expect(useUiStore.getState().pendingBudgetEditor).toBe(false);
  });

  it('Each month replaces Each pay cycle when the profile counts by month', async () => {
    const r = await mountNode(<BudgetsScreen api={fakeApi([], { payCycle: false }).api} />);
    await press(r, 'budgets-add');
    expect(texts(r)).toContain('Each month');
    expect(texts(r)).not.toContain('Each pay cycle');
  });

  it('Everything fixes the period with the caption, and says your month when not salaried', async () => {
    const r = await mountNode(<BudgetsScreen api={fakeApi().api} />);
    await press(r, 'budgets-add');
    await press(r, 'budget-for-overall');
    expect(texts(r)).toContain('An overall budget always follows your pay cycle');
    expect(has(r, 'budget-period-monthly')).toBe(false);
    const m = await mountNode(<BudgetsScreen api={fakeApi([], { payCycle: false }).api} />);
    await press(m, 'budgets-add');
    await press(m, 'budget-for-overall');
    expect(texts(m)).toContain('An overall budget always follows your month');
  });

  it('saves a ₹6,000 monthly Groceries budget and toasts Budget saved with Undo', async () => {
    const f = fakeApi();
    const r = await mountNode(<BudgetsScreen api={f.api} />);
    await press(r, 'budgets-add');
    await press(r, 'budget-category-cat_groceries');
    await press(r, 'budget-period-monthly');
    await type(r, 'budget-limit', '6000');
    await press(r, 'budget-save');
    expect(f.save).toHaveBeenCalledWith({ scope: 'category', categoryIds: ['cat_groceries'], accountIds: null, periodRule: 'monthly', targetMinor: 600_000, alertLevels: [75, 90, 100], muted: false });
    expect(has(r, 'budget-sheet')).toBe(false);
    expect(texts(r)).toContain('Budget saved');
    await press(r, 'toast-undo');
    expect(f.undo).toHaveBeenCalledWith(expect.objectContaining({ budgetId: 'new', created: true }));
  });

  it('an empty limit, no category and an end before the start show the inline error, keep the input and write nothing', async () => {
    const f = fakeApi();
    const r = await mountNode(<BudgetsScreen api={f.api} />);
    await press(r, 'budgets-add');
    await press(r, 'budget-save');
    expect(texts(r)).toContain('Error: amount required');
    await type(r, 'budget-limit', '6000');
    await press(r, 'budget-save');
    expect(texts(r)).toContain('Error: choose at least one category');
    expect(host(r, 'budget-limit').props.value).toBe('6000');
    await press(r, 'budget-category-cat_groceries');
    await press(r, 'budget-period-custom');
    await type(r, 'budget-from', '2026-11-15');
    await type(r, 'budget-to', '2026-11-01');
    await press(r, 'budget-save');
    expect(texts(r)).toContain('Error: end date is before start date');
    expect(f.save).not.toHaveBeenCalled();
    expect(has(r, 'budget-sheet')).toBe(true);
  });

  it('a second overall budget reads You already have an overall budget with Edit it, and creates nothing', async () => {
    const f = fakeApi([row({ id: 'o', name: 'Overall', group: 'overall', scope: 'overall' })], { save: async () => ({ ok: false, code: 'OVERALL_EXISTS:o' }) as SaveBudgetOutcome });
    const r = await mountNode(<BudgetsScreen api={f.api} />);
    await press(r, 'budgets-add');
    await press(r, 'budget-for-overall');
    await type(r, 'budget-limit', '50000');
    await press(r, 'budget-save');
    expect(texts(r)).toContain('You already have an overall budget.');
    await press(r, 'budget-edit-existing');
    expect(f.readForEdit).toHaveBeenCalledWith('o');
    expect(texts(r)).toContain('Edit budget');
    expect(host(r, 'budget-limit').props.value).toBe('50000');
  });

  it('tapping a row opens it for editing with its limit', async () => {
    const f = fakeApi([row({ id: 'o', name: 'Overall', group: 'overall', scope: 'overall' })]);
    const r = await mountNode(<BudgetsScreen api={f.api} />);
    await press(r, 'budget-row-o');
    expect(host(r, 'budget-limit').props.value).toBe('50000');
  });

  it('a failed save keeps the sheet and says nothing was saved', async () => {
    const f = fakeApi([], { save: async () => ({ ok: false, code: 'WRITE_FAILED' }) });
    const r = await mountNode(<BudgetsScreen api={f.api} />);
    await press(r, 'budgets-add');
    await press(r, 'budget-category-cat_groceries');
    await type(r, 'budget-limit', '6000');
    await press(r, 'budget-save');
    expect(texts(r)).toContain('Could not save this budget. Nothing was saved.');
  });
});

describe('alerts in the editor and the first-time ask (Story 4.9)', () => {
  const toggleAlerts = async (r: ReactTestRenderer, on: boolean) => {
    await act(async () => r.root.findAll((n) => n.props.testID === 'budget-alerts-switch' && typeof n.props.onValueChange === 'function')[0]!.props.onValueChange(on));
    await settle();
  };
  const fill = async (r: ReactTestRenderer) => {
    await press(r, 'budget-category-cat_groceries');
    await type(r, 'budget-limit', '6000');
  };
  const withAsk = (ask: boolean) => {
    const f = fakeApi();
    const shouldAskForAlerts = jest.fn(async () => ask);
    const answerAlertAsk = jest.fn<Promise<void>, [boolean]>(async () => undefined);
    return { ...f, api: { ...f.api, shouldAskForAlerts, answerAlertAsk } as BudgetsApi, shouldAskForAlerts, answerAlertAsk };
  };

  it('Alerts for this budget is on by default, and turning it off saves the budget muted', async () => {
    const f = fakeApi();
    const r = await mountNode(<BudgetsScreen api={f.api} />);
    await press(r, 'budgets-add');
    expect(host(r, 'budget-alerts-switch').props.value).toBe(true);
    await fill(r);
    await toggleAlerts(r, false);
    await press(r, 'budget-save');
    expect(f.save).toHaveBeenCalledWith(expect.objectContaining({ muted: true, alertLevels: [75, 90, 100] }));
  });

  it('with alerts on it saves unmuted; deselecting every Alert me at chip sends no level (the budget is muted by the save)', async () => {
    const f = fakeApi();
    const r = await mountNode(<BudgetsScreen api={f.api} />);
    await press(r, 'budgets-add');
    await fill(r);
    await press(r, 'budget-save');
    expect(f.save).toHaveBeenLastCalledWith(expect.objectContaining({ muted: false }));
    await press(r, 'budgets-add');
    await fill(r);
    for (const l of [75, 90, 100]) await press(r, `budget-alert-${l}`);
    await press(r, 'budget-save');
    expect(f.save).toHaveBeenLastCalledWith(expect.objectContaining({ alertLevels: [] }));
  });

  it('the first budget saved with alerts on offers Get a heads-up near your limits? once; Allow notifications answers yes', async () => {
    const f = withAsk(true);
    const r = await mountNode(<BudgetsScreen api={f.api} />);
    await press(r, 'budgets-add');
    await fill(r);
    await press(r, 'budget-save');
    await act(async () => new Promise((res) => setTimeout(res, 10)));
    await settle();
    expect(texts(r)).toContain('Get a heads-up near your limits?');
    expect(f.answerAlertAsk).not.toHaveBeenCalled();
    await press(r, 'alert-ask-allow');
    expect(f.answerAlertAsk).toHaveBeenCalledWith(true);
    expect(has(r, 'alert-ask')).toBe(false);
  });

  it('Not now answers no and asks nothing more', async () => {
    const f = withAsk(true);
    const r = await mountNode(<BudgetsScreen api={f.api} />);
    await press(r, 'budgets-add');
    await fill(r);
    await press(r, 'budget-save');
    await act(async () => new Promise((res) => setTimeout(res, 10)));
    await settle();
    await press(r, 'alert-ask-later');
    expect(f.answerAlertAsk).toHaveBeenCalledWith(false);
  });

  it('is not offered when it was asked before, the notifier is not available, or the budget is muted', async () => {
    const never = withAsk(false);
    const a = await mountNode(<BudgetsScreen api={never.api} />);
    await press(a, 'budgets-add');
    await fill(a);
    await press(a, 'budget-save');
    await act(async () => new Promise((res) => setTimeout(res, 10)));
    expect(has(a, 'alert-ask')).toBe(false);
    const muted = withAsk(true);
    const b = await mountNode(<BudgetsScreen api={muted.api} />);
    await press(b, 'budgets-add');
    await fill(b);
    await toggleAlerts(b, false);
    await press(b, 'budget-save');
    await act(async () => new Promise((res) => setTimeout(res, 10)));
    expect(has(b, 'alert-ask')).toBe(false);
    expect(muted.shouldAskForAlerts).not.toHaveBeenCalled();
  });
});

describe('One-tap 50/30/20 targets (Story 4.10)', () => {
  const open = async (opts: Parameters<typeof fakeApi>[1] = {}) => {
    const f = fakeApi([], opts);
    const r = await mountNode(<BudgetsScreen api={f.api} />);
    await press(r, 'budgets-use-503020');
    return { f, r };
  };
  const rowsOf = (r: ReactTestRenderer) => ['needs', 'wants', 'savings'].map((k) => host(r, `template-${k}`).props.value);

  it('asks for the monthly income (per pay cycle when salaried), with the change-later caption, empty when nothing is known', async () => {
    const monthly = await open({ payCycle: false });
    expect(texts(monthly.r)).toEqual(expect.arrayContaining(['Your monthly income', 'You can change these later']));
    expect(host(monthly.r, 'template-income').props.value).toBe('');
    const cycle = await open({ payCycle: true });
    expect(texts(cycle.r)).toContain('Your income per pay cycle');
  });

  it('is pre-filled with the best income known (Salary, or the onboarding figure) and previews the rows', async () => {
    const { r } = await open({ template: { suggestedIncomeMinor: 8_000_000, suggestionSource: 'onboarding' } });
    expect(host(r, 'template-income').props.value).toBe('80000');
    expect(rowsOf(r)).toEqual(['40000', '24000', '16000']);
  });

  it('Create targets saves the exact split and toasts 50/30/20 targets created with Undo', async () => {
    const { f, r } = await open();
    await type(r, 'template-income', '80000');
    expect(rowsOf(r)).toEqual(['40000', '24000', '16000']);
    await press(r, 'template-save');
    expect(f.createTemplate).toHaveBeenCalledWith(8_000_000, undefined);
    expect(has(r, 'template-sheet')).toBe(false);
    expect(texts(r)).toContain('50/30/20 targets created');
    await press(r, 'toast-undo');
    expect(f.undoTemplate).toHaveBeenCalledWith(['n', 'w', 's']);
  });

  it('an income that does not divide exactly puts the leftover minor unit in Savings', async () => {
    const { r } = await open();
    await type(r, 'template-income', '80000.01');
    expect(rowsOf(r)).toEqual(['40000', '24000', '16000.01']);
  });

  it('an edited row is saved as typed and the caption says the targets add up to more than the income', async () => {
    const { f, r } = await open();
    await type(r, 'template-income', '80000');
    expect(has(r, 'template-sum')).toBe(false);
    await type(r, 'template-needs', '42000');
    expect(texts(r)).toEqual(expect.arrayContaining(['Targets add up to  of  income', '₹82,000.00', '₹80,000.00']));
    await press(r, 'template-save');
    expect(f.createTemplate).toHaveBeenCalledWith(8_000_000, { needsMinor: 4_200_000, wantsMinor: 2_400_000, savingsMinor: 1_600_000 });
  });

  it('an empty or zero income says Error: income required and writes nothing', async () => {
    const { f, r } = await open();
    await press(r, 'template-save');
    expect(texts(r)).toContain('Error: income required');
    await type(r, 'template-income', '0');
    await press(r, 'template-save');
    expect(texts(r)).toContain('Error: income required');
    expect(f.createTemplate).not.toHaveBeenCalled();
    expect(has(r, 'template-sheet')).toBe(true);
  });

  it('when 50/30/20 already exists it says so and offers Edit targets; no second set is created', async () => {
    const { f, r } = await open({ template: { exists: true, incomeMinor: 8_000_000, targets: { needsMinor: 4_000_000, wantsMinor: 2_400_000, savingsMinor: 1_600_000 } } });
    expect(texts(r)).toContain('You already use 50/30/20.');
    expect(f.createTemplate).not.toHaveBeenCalled();
    await press(r, 'template-edit');
    expect(rowsOf(r)).toEqual(['40000', '24000', '16000']);
    await type(r, 'template-savings', '20000');
    await press(r, 'template-save');
    expect(f.changeTemplate).toHaveBeenCalledWith({ needsMinor: 4_000_000, wantsMinor: 2_400_000, savingsMinor: 2_000_000 });
    expect(f.createTemplate).not.toHaveBeenCalled();
  });

  it('the setup card You wanted to try 50/30/20 opens the sheet pre-filled with the onboarding figure; dismissing is remembered and creates nothing', async () => {
    const f = fakeApi([], { template: { showSetupCard: true, onboardingYes: true, onboardingIncomeMinor: 8_000_000, suggestedIncomeMinor: 9_500_000, suggestionSource: 'salary' } });
    const r = await mountNode(<BudgetsScreen api={f.api} />);
    expect(texts(r)).toContain('You wanted to try 50/30/20');
    await press(r, 'template-card-setup');
    expect(host(r, 'template-income').props.value).toBe('80000');
    expect(f.createTemplate).not.toHaveBeenCalled();
    const g = fakeApi([], { template: { showSetupCard: true, onboardingYes: true, onboardingIncomeMinor: 8_000_000 } });
    const d = await mountNode(<BudgetsScreen api={g.api} />);
    await press(d, 'template-card-dismiss');
    expect(g.dismissTemplateCard).toHaveBeenCalled();
    expect(g.createTemplate).not.toHaveBeenCalled();
  });

  it('with no setup card flagged there is no card', async () => {
    const r = await mountNode(<BudgetsScreen api={fakeApi().api} />);
    expect(has(r, 'template-card')).toBe(false);
  });
});

describe('Savings bar status (Story 4.11): never a warning, never Over by', () => {
  const sav = (used: number, target = 1_600_000) => budgetStatus({ usedMinor: used, targetMinor: target, period: NOV, today: '2026-11-12' });

  it('below the target it says how far to go; at or above it, Target reached', () => {
    expect(savingsStatusLine(sav(600_000), INR, 'en-IN', false)).toEqual({ text: '₹10,000.00 to go · 19 days left', warning: false });
    expect(savingsStatusLine(sav(1_600_000), INR, 'en-IN', false)).toEqual({ text: 'Target reached', warning: false });
    expect(savingsStatusLine(sav(1_800_000), INR, 'en-IN', false)).toEqual({ text: 'Target reached', warning: false });
  });

  it('hidden masks the amount and the label drops the figures', () => {
    expect(savingsStatusLine(sav(600_000), INR, 'en-IN', true).text).toBe('₹ •••• to go · 19 days left');
    expect(savingsLabel('Savings', sav(1_800_000), INR, 'en-IN', false, false)).toBe('Savings, 18,000 rupees of 16,000 rupees, Target reached');
    expect(savingsLabel('Savings', sav(0), INR, 'en-IN', false, true)).toContain('More moved out than in this period');
  });

  it('no text of a savings status has a minus sign or Over by', () => {
    for (const used of [0, 500_000, 1_600_000, 3_000_000]) {
      const t = savingsStatusLine(sav(used), INR, 'en-IN', false).text;
      expect(t).not.toMatch(/[-−–]|Over by/);
    }
  });
});

describe('Needs, Wants and Savings on the list (Story 4.11)', () => {
  const tpl = (over: Partial<BudgetListRow> & { id: string; name: string }): BudgetListRow => row({ group: '50_30_20', scope: 'budget_type', ...over });
  const THREE = (savings: Partial<BudgetListRow> = {}): BudgetListRow[] => [
    tpl({ id: 'n', name: 'Needs', budgetType: 'need', usedMinor: 2_200_000, targetMinor: 4_000_000, status: status(2_200_000, 4_000_000) }),
    tpl({ id: 'w', name: 'Wants', budgetType: 'want', usedMinor: 500_000, targetMinor: 2_400_000, status: status(500_000, 2_400_000) }),
    tpl({ id: 's', name: 'Savings', scope: 'savings', usedMinor: 1_800_000, targetMinor: 1_600_000, savingsMovedMinor: 1_800_000, status: status(1_800_000, 1_600_000), ...savings }),
  ];

  it('shows the three bars with values, and a Savings above its target reads Target reached with no overflow or Over by', async () => {
    const r = await mountNode(<BudgetsScreen api={fakeApi(THREE()).api} />);
    expect(texts(r)).toEqual(expect.arrayContaining(['Needs', 'Wants', 'Savings', '₹22,000.00 of ₹40,000.00', '₹18,000.00 of ₹16,000.00', 'Target reached']));
    expect(has(r, 'limit-s-overflow')).toBe(false);
    expect(texts(r).join('|')).not.toMatch(/Over by/);
    expect(host(r, 'limit-s').props.accessibilityLabel).toContain('Target reached');
  });

  it('a net outflow shows zero with More moved out than in this period, never a minus sign', async () => {
    const f = fakeApi(THREE({ usedMinor: 0, savingsMovedMinor: -50_000, status: status(0, 1_600_000) }));
    const r = await mountNode(<BudgetsScreen api={f.api} />);
    expect(texts(r)).toContain('More moved out than in this period');
    expect(texts(r)).toContain('₹0.00 of ₹16,000.00');
    expect(texts(r).join('|')).not.toMatch(/[-−]\s?₹/);
  });

  it('Not classified ₹3,000 · Sort it opens Activity for those entries in the period; nothing shows at zero', async () => {
    const onOpenActivity = jest.fn();
    const summary = { notClassifiedMinor: 300_000, categoryIds: ['cat_uncategorised', 'cat_family'], period: { start: '2026-11-01', end: '2026-11-30' } };
    const r = await mountNode(<BudgetsScreen api={fakeApi(THREE(), { typeSummary: summary }).api} onOpenActivity={onOpenActivity} />);
    expect(texts(r)).toContain('Not classified ₹3,000.00 · Sort it');
    await press(r, 'budgets-not-classified');
    expect(onOpenActivity).toHaveBeenCalledWith({ categoryIds: ['cat_uncategorised', 'cat_family'], fromDate: '2026-11-01', toDate: '2026-11-30' });
    const none = await mountNode(<BudgetsScreen api={fakeApi(THREE(), { typeSummary: { ...summary, notClassifiedMinor: 0 } }).api} />);
    expect(has(none, 'budgets-not-classified')).toBe(false);
  });

  it('with Hide amounts on, the budget list (limit bars, Needs, Wants, Savings, Not classified) shows and speaks no money', async () => {
    useAmountsStore.getState().setHidden(true);
    try {
      const summary = { notClassifiedMinor: 300_000, categoryIds: ['cat_uncategorised'], period: { start: '2026-11-01', end: '2026-11-30' } };
      const r = await mountNode(<BudgetsScreen api={fakeApi(THREE(), { typeSummary: summary }).api} />);
      expect(moneyLeaks(r)).toEqual([]);
      expect(texts(r)).toContain('Not classified ₹ •••• · Sort it'); // the line and its label stay, the amount is masked
    } finally {
      useAmountsStore.getState().setHidden(false);
    }
  });

  it('hiding amounts while the budget list is open masks it in place', async () => {
    try {
      const summary = { notClassifiedMinor: 300_000, categoryIds: ['cat_uncategorised'], period: { start: '2026-11-01', end: '2026-11-30' } };
      const r = await mountNode(<BudgetsScreen api={fakeApi(THREE(), { typeSummary: summary }).api} />);
      expect(moneyLeaks(r)).not.toEqual([]);
      act(() => useAmountsStore.getState().setHidden(true));
      expect(moneyLeaks(r)).toEqual([]);
    } finally {
      act(() => useAmountsStore.getState().setHidden(false));
    }
  });

  it('the income-changed card offers Update to the new figure or Keep the old one; nothing changes until a tap', async () => {
    const change = { oldIncomeMinor: 8_000_000, newIncomeMinor: 9_000_000, periodStart: '2026-11-01' };
    const f = fakeApi(THREE(), { template: { exists: true, incomeChange: change } });
    const r = await mountNode(<BudgetsScreen api={f.api} />);
    expect(texts(r)).toContain('Your income changed — update 50/30/20 to ₹90,000.00?');
    expect(has(r, 'income-card-keep')).toBe(true);
    expect(f.answerIncomeChange).not.toHaveBeenCalled();
    await press(r, 'income-card-update');
    expect(f.answerIncomeChange).toHaveBeenCalledWith(true, { newIncomeMinor: 9_000_000, periodStart: '2026-11-01' });
    const g = fakeApi(THREE(), { template: { exists: true, incomeChange: change } });
    const k = await mountNode(<BudgetsScreen api={g.api} />);
    await press(k, 'income-card-keep');
    expect(g.answerIncomeChange).toHaveBeenCalledWith(false, { newIncomeMinor: 9_000_000, periodStart: '2026-11-01' });
  });

  it('no income card when the income did not change enough', async () => {
    const r = await mountNode(<BudgetsScreen api={fakeApi(THREE(), { template: { exists: true } }).api} />);
    expect(has(r, 'income-card')).toBe(false);
  });
});
