import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { mapCategoryRows, SEED_CATEGORIES, type BillDetail, type BillRowModel, type BillRule, type SaveRecurringRuleInput } from '@wmbugo/core';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { BillsScreen } from './BillsScreen';
import { BillDetailScreen } from './BillDetailScreen';
import type { BillDetailData, BillOutcome, BillsApi, BillsData } from './billsApi';
import { cadenceText, statusText } from './billText';

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

const row = (over: Partial<BillRowModel> = {}): BillRowModel => ({
  id: 'r1', title: 'Rent', kind: 'rent', cadence: 'monthly', customEvery: null, customUnit: null, expectedAmountMinor: 1_800_000, accountId: 'a1', accountName: 'HDFC', categoryId: 'cat_housing', categoryName: 'Housing', categoryIcon: 'House', categoryColor: 'cat-brown',
  state: 'active', nextDue: '2026-12-05', status: { kind: 'upcoming', date: '2026-12-05', daysUntilDue: null, paidBy: null }, hasPayments: false, ...over,
});
const rule = (over: Partial<BillRule> = {}): BillRule => ({
  id: 'r1', title: 'Rent', expectedAmountMinor: 1_800_000, cadence: 'monthly', customEvery: null, customUnit: null, anchorDate: '2026-12-05', accountId: 'a1', categoryId: 'cat_housing', kind: 'rent', paidTo: 'Ramesh', endsOn: null,
  pausedAt: null, pausedOn: null, resumedOn: null, endedAt: null, endedOn: null, removedAt: null, ...over,
});

const categories = mapCategoryRows(SEED_CATEGORIES.map((c, i) => [c.id, c.name, c.kind, c.budgetType, c.icon, c.color, i, null]));
const pickers = { categories, accounts: [{ id: 'a1', name: 'HDFC' }, { id: 'a2', name: 'Cash' }] };

const data = (rows: { active?: BillRowModel[]; paused?: BillRowModel[]; ended?: BillRowModel[] } = {}): BillsData => ({
  list: { today: '2026-11-12', active: rows.active ?? [], paused: rows.paused ?? [], ended: rows.ended ?? [] },
  currency: 'INR', locale: 'en-IN', exponent: 2, ...pickers,
});

const fakeApi = (d: BillsData, detail?: BillDetailData | 'missing') => {
  const ok: BillOutcome = { ok: true };
  const api = {
    load: jest.fn(async () => d),
    loadDetail: jest.fn(async () => detail ?? 'missing'),
    save: jest.fn(async (input: SaveRecurringRuleInput) => ({ input, ok: true as const, value: { ruleId: 'new1', created: true } })),
    remove: jest.fn(async () => ok),
    restore: jest.fn(async () => ok),
    pause: jest.fn(async () => ok),
    resume: jest.fn(async () => ok),
    end: jest.fn(async () => ok),
    markPaid: jest.fn(async () => ok),
    unmarkPaid: jest.fn(async () => ok),
  };
  return api as typeof api & BillsApi;
};

const detailData = (over: Partial<BillDetail> = {}): BillDetailData => ({
  detail: { rule: rule(), row: row(), today: '2026-11-12', history: [], markableDate: '2026-12-05', canDelete: true, ...over },
  currency: 'INR', locale: 'en-IN', exponent: 2, ...pickers,
});

describe('bill text', () => {
  it('reads cadence and the one status line without any amount', () => {
    expect(cadenceText({ cadence: 'custom', customEvery: 10, customUnit: 'days' })).toBe('Every 10 days');
    expect(cadenceText({ cadence: 'quarterly', customEvery: null, customUnit: null })).toBe('Every 3 months');
    expect(statusText({ kind: 'upcoming', date: '2026-12-05', daysUntilDue: null, paidBy: null })).toEqual({ text: 'Due 5 Dec', tone: 'normal' });
    expect(statusText({ kind: 'due_soon', date: '2026-11-14', daysUntilDue: 2, paidBy: null })).toEqual({ text: 'Due in 2 days', tone: 'warning' });
    expect(statusText({ kind: 'due_soon', date: '2026-11-13', daysUntilDue: 1, paidBy: null }).text).toBe('Due tomorrow');
    expect(statusText({ kind: 'due_soon', date: '2026-11-12', daysUntilDue: 0, paidBy: null }).text).toBe('Due today');
    expect(statusText({ kind: 'paid', date: '2026-11-05', daysUntilDue: null, paidBy: 'marked' }).text).toBe('Paid · marked by you');
    expect(statusText({ kind: 'not_seen_yet', date: '2026-11-05', daysUntilDue: null, paidBy: null })).toEqual({ text: 'Not seen yet · was due 5 Nov', tone: 'muted' });
  });
});

describe('Bills & Recurring (Story 6.2)', () => {
  it('with no bills shows the empty state, and an incomplete bill is refused with the field errors and nothing written', async () => {
    const api = fakeApi(data());
    const r = await mountNode(<BillsScreen api={api} onBack={() => undefined} onOpenBill={() => undefined} />);
    expect(texts(r)).toContain('No bills yet. Rent, phone, subscriptions?');
    await press(r, 'empty-state-action');
    expect(has(r, 'bill-sheet')).toBe(true);
    await press(r, 'bill-save');
    expect(texts(r)).toContain('Error: name required');
    await type(r, 'bill-name', 'Rent');
    await press(r, 'bill-save');
    expect(texts(r)).toContain('Error: amount required');
    await type(r, 'bill-amount', '18000');
    await press(r, 'bill-save');
    expect(texts(r)).toContain('Error: choose a due date');
    await type(r, 'bill-due', '2026-12-05');
    await press(r, 'bill-ends-date');
    await type(r, 'bill-ends-on', '2026-12-01');
    await press(r, 'bill-save');
    expect(texts(r)).toContain('Error: end date is before the next due date');
    expect(api.save).not.toHaveBeenCalled();
  });

  it('saves Rent, 18,000, monthly, due 5 Dec from HDFC with the Housing category and shows Bill added with Undo', async () => {
    const api = fakeApi(data());
    const r = await mountNode(<BillsScreen api={api} onBack={() => undefined} onOpenBill={() => undefined} />);
    await press(r, 'empty-state-action');
    await press(r, 'bill-kind-rent');
    await type(r, 'bill-name', 'Rent');
    await type(r, 'bill-amount', '18000');
    await type(r, 'bill-due', '2026-12-05');
    await press(r, 'bill-save');
    expect(api.save).toHaveBeenCalledWith({ title: 'Rent', expectedAmountMinor: 1_800_000, cadence: 'monthly', anchorDate: '2026-12-05', accountId: 'a1', categoryId: 'cat_housing', kind: 'rent', paidTo: null, endsOn: null });
    expect(has(r, 'bill-sheet')).toBe(false);
    expect(texts(r)).toContain('Bill added');
    await press(r, 'toast-undo');
    expect(api.remove).toHaveBeenCalledWith('new1');
  });

  it('a custom repeat needs 1 to 99, and a kind pre-selects its category', async () => {
    const api = fakeApi(data());
    const r = await mountNode(<BillsScreen api={api} onBack={() => undefined} onOpenBill={() => undefined} />);
    await press(r, 'empty-state-action');
    await type(r, 'bill-name', 'Gym');
    await type(r, 'bill-amount', '999');
    await type(r, 'bill-due', '2026-12-05');
    await press(r, 'bill-cadence-custom');
    await type(r, 'bill-every', '100');
    await press(r, 'bill-save');
    expect(texts(r)).toContain('Error: choose how often, 1 to 99');
    await type(r, 'bill-every', '10');
    await press(r, 'bill-kind-subscription');
    await press(r, 'bill-save');
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ cadence: 'custom', customEvery: 10, customUnit: 'days', kind: 'subscription', categoryId: 'cat_entertainment' }));
  });

  it('lists active bills with their status line, Paused and Ended collapsed, and opens a bill', async () => {
    const api = fakeApi(data({
      active: [
        row({ id: 'p', title: 'Phone', status: { kind: 'due_soon', date: '2026-11-14', daysUntilDue: 2, paidBy: null }, nextDue: '2026-11-14' }),
        row({ id: 'e', title: 'EMI', status: { kind: 'not_seen_yet', date: '2026-11-05', daysUntilDue: null, paidBy: null } }),
        row({ id: 'r1' }),
      ],
      paused: [row({ id: 'g', title: 'Gym', state: 'paused', status: { kind: 'paused', date: null, daysUntilDue: null, paidBy: null }, nextDue: null })],
    }));
    const opened: string[] = [];
    const r = await mountNode(<BillsScreen api={api} onBack={() => undefined} onOpenBill={(id) => opened.push(id)} />);
    expect(texts(r)).toEqual(expect.arrayContaining(['Due in 2 days', 'Not seen yet · was due 5 Nov', 'Due 5 Dec', 'Paused (1)']));
    expect(has(r, 'bill-row-g')).toBe(false);
    await press(r, 'bills-toggle-paused');
    expect(has(r, 'bill-row-g')).toBe(true);
    await press(r, 'bill-row-r1');
    expect(opened).toEqual(['r1']);
  });

  it('Mark as paid asks first, then marks the not-seen date and offers Undo', async () => {
    const api = fakeApi(data({ active: [row({ id: 'e', title: 'EMI', status: { kind: 'not_seen_yet', date: '2026-11-05', daysUntilDue: null, paidBy: null } })] }));
    const r = await mountNode(<BillsScreen api={api} onBack={() => undefined} onOpenBill={() => undefined} />);
    await press(r, 'bill-mark-e');
    expect(texts(r)).toContain("Mark EMI as paid for 5 Nov? This doesn't add an entry.");
    expect(api.markPaid).not.toHaveBeenCalled();
    await press(r, 'bill-mark-confirm');
    expect(api.markPaid).toHaveBeenCalledWith('e', '2026-11-05');
    expect(texts(r)).toContain('Marked as paid');
    await press(r, 'toast-undo');
    expect(api.unmarkPaid).toHaveBeenCalledWith('e', '2026-11-05');
  });

  it('hidden amounts show ₹ •••• on a row while the day status stays', async () => {
    const { useAmountsStore } = jest.requireActual('../../shared/state/amountsHidden') as typeof import('../../shared/state/amountsHidden');
    useAmountsStore.setState({ hidden: true } as never);
    try {
      const api = fakeApi(data({ active: [row()] }));
      const r = await mountNode(<BillsScreen api={api} onBack={() => undefined} onOpenBill={() => undefined} />);
      expect(texts(r).join(' ')).not.toContain('18,000');
      expect(texts(r)).toContain('Due 5 Dec');
      expect(r.root.findAll((n) => n.props.testID === 'bill-row-r1')[0]!.props.accessibilityLabel).not.toMatch(/18,000|eighteen/i);
    } finally {
      act(() => useAmountsStore.setState({ hidden: false } as never));
    }
  });
});

describe('Bill detail (Story 6.2)', () => {
  it('shows the next due date, the history and the actions; Delete only without payment history', async () => {
    const api = fakeApi(data(), detailData());
    const r = await mountNode(<BillDetailScreen ruleId="r1" api={api} onBack={() => undefined} />);
    expect(texts(r)).toEqual(expect.arrayContaining(['Next due 5 Dec', 'No history yet.']));
    for (const id of ['bill-detail-mark', 'bill-detail-edit', 'bill-detail-pause', 'bill-detail-end', 'bill-detail-delete']) expect(has(r, id)).toBe(true);
    expect(has(r, 'bill-detail-has-history')).toBe(false);
  });

  it('with payment history Delete is replaced by the end-it-instead note, and history lines read as the spec says', async () => {
    const d = detailData({
      row: row({ hasPayments: true }),
      canDelete: false,
      history: [{ dueDate: '2026-11-05', status: 'paid', paidBy: 'marked', transactionId: null }, { dueDate: '2026-10-05', status: 'not_marked_paid', paidBy: null, transactionId: null }],
    });
    const r = await mountNode(<BillDetailScreen ruleId="r1" api={fakeApi(data(), d)} onBack={() => undefined} />);
    expect(has(r, 'bill-detail-delete')).toBe(false);
    expect(texts(r)).toEqual(expect.arrayContaining(['Rent has payment history. End it instead to keep it.', 'Paid 5 Nov · marked by you', 'Not marked paid · 5 Oct']));
  });

  it('Mark as paid, Pause, End and Delete run their commands after the confirmation', async () => {
    const api = fakeApi(data(), detailData());
    const back = jest.fn();
    const r = await mountNode(<BillDetailScreen ruleId="r1" api={api} onBack={back} />);
    await press(r, 'bill-detail-mark');
    await press(r, 'bill-mark-confirm');
    expect(api.markPaid).toHaveBeenCalledWith('r1', '2026-12-05');
    await press(r, 'bill-detail-pause');
    expect(api.pause).toHaveBeenCalledWith('r1');
    await press(r, 'bill-detail-end');
    expect(texts(r)).toContain('End Rent? Its history stays.');
    await press(r, 'bill-end-confirm');
    expect(api.end).toHaveBeenCalledWith('r1');
    await press(r, 'bill-detail-delete');
    expect(texts(r)).toContain('Delete Rent?');
    await press(r, 'bill-delete-confirm');
    expect(api.remove).toHaveBeenCalledWith('r1');
    expect(back).toHaveBeenCalled();
  });

  it('a paused bill offers Resume, not Pause or Mark as paid', async () => {
    const d = detailData({ row: row({ state: 'paused', status: { kind: 'paused', date: null, daysUntilDue: null, paidBy: null }, nextDue: null }), markableDate: null, rule: rule({ pausedAt: 1, pausedOn: '2026-11-10' }) });
    const api = fakeApi(data(), d);
    const r = await mountNode(<BillDetailScreen ruleId="r1" api={api} onBack={() => undefined} />);
    expect(has(r, 'bill-detail-resume')).toBe(true);
    expect(has(r, 'bill-detail-pause')).toBe(false);
    expect(has(r, 'bill-detail-mark')).toBe(false);
    await press(r, 'bill-detail-resume');
    expect(api.resume).toHaveBeenCalledWith('r1');
  });

  it('a deleted bill shows the way back', async () => {
    const r = await mountNode(<BillDetailScreen ruleId="r1" api={fakeApi(data())} onBack={() => undefined} />);
    expect(texts(r)).toContain('This bill was deleted.');
  });
});
