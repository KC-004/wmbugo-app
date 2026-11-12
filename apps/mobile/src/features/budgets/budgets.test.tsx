import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { budgetStatus, mapCategoryRows, SEED_CATEGORIES, type BudgetListRow, type BudgetSnapshot, type SaveBudgetInput } from '@wmbugo/core';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { BudgetsScreen } from './BudgetsScreen';
import { barGeometry, limitBarLabel, LimitBar, OVERFLOW_CAP, statusLine } from '../../shared/ui/LimitBar';
import type { BudgetsApi, BudgetsData, SaveBudgetOutcome } from './budgetsApi';

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
  group: 'categories', scope: 'category', period: { ...NOV, kind: 'calendar_month' }, periodLabel: '1–30 Nov', usedMinor: 340_000, targetMinor: 600_000, refundSurplusMinor: 0, status: status(340_000, 600_000), overlapsOverall: false, ...over,
});

function fakeApi(rows: BudgetListRow[] = [], opts: { payCycle?: boolean; save?: BudgetsApi['save'] } = {}) {
  const state = { rows };
  const data = (): BudgetsData => ({
    list: { today: '2026-11-12', rows: state.rows, overallId: state.rows.find((r) => r.group === 'overall')?.id ?? null },
    currency: INR, locale: 'en-IN', exponent: 2, payCycle: opts.payCycle ?? true, categories: CATEGORIES,
    accounts: [{ id: 'a1', name: 'HDFC' }, { id: 'a2', name: 'Cash' }],
  });
  const save = jest.fn<ReturnType<BudgetsApi['save']>, [SaveBudgetInput]>(opts.save ?? (async (input) => {
    state.rows = [...state.rows, row({ id: `b${state.rows.length + 1}`, name: input.scope === 'overall' ? 'Overall' : 'Groceries', group: input.scope === 'overall' ? 'overall' : 'categories', scope: input.scope })];
    return { ok: true, value: { budgetId: 'new', created: true, snapshot: {} as BudgetSnapshot } };
  }));
  const undo = jest.fn(async () => ({ ok: true }));
  const readForEdit = jest.fn(async (id: string) => ({ id, scope: 'overall' as const, categoryIds: [], budgetType: null, accountIds: null, period: { rule: 'default' as const }, targetMinor: 5_000_000, currentPeriodStart: '2026-11-01', nextPeriodStart: '2026-12-01' }));
  const api: BudgetsApi = { load: async () => data(), readForEdit, save, undo, loadDetail: async () => null, remove: async () => ({ ok: true }), restore: async () => ({ ok: true }) };
  return { api, save, undo, readForEdit, state };
}

describe('Budgets list (SCR-14, Story 4.6)', () => {
  it('with no budgets: the empty state with Add budget, and no 50/30/20 button until Story 4.10 wires it', async () => {
    const f = fakeApi();
    const r = await mountNode(<BudgetsScreen api={f.api} />);
    expect(texts(r)).toContain('No budgets yet. Set one limit for this period.');
    expect(has(r, 'budgets-add')).toBe(true);
    expect(has(r, 'budgets-use-503020')).toBe(false);
    const withTemplate = await mountNode(<BudgetsScreen api={f.api} onUseTemplate={() => undefined} />);
    expect(has(withTemplate, 'budgets-use-503020')).toBe(true);
  });

  it('groups Overall, 50/30/20 and Categories, labels each period and flags a category budget that overlaps the overall one', async () => {
    const f = fakeApi([
      row({ id: 'o', name: 'Overall', group: 'overall', scope: 'overall' }),
      row({ id: 'g', name: 'Groceries', overlapsOverall: true }),
      row({ id: 'w', name: 'Food & Drinks', periodLabel: 'Weekly · 9–15 Nov' }),
      row({ id: 'n', name: 'Needs', group: 'fifty_thirty_twenty', scope: 'budget_type' }),
    ]);
    const r = await mountNode(<BudgetsScreen api={f.api} />);
    const groups = r.root.findAll((n) => typeof n.type === 'string' && /^budgets-group-/.test(String(n.props.testID))).map((n) => n.props.testID);
    expect(groups).toEqual(['budgets-group-overall', 'budgets-group-fifty_thirty_twenty', 'budgets-group-categories']);
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
