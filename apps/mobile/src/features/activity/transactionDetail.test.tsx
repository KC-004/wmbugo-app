import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { groupByDay, type ActivityRow, type TransactionDetail, type TxSnapshot } from '@wmbugo/core';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { cleanup, fire, has, host, mountReady, quietAccessibility, settle, tap, texts } from '../add/testKit';
import { ActivityScreen } from './ActivityScreen';
import type { ActivityApi, ActivityData } from './activityApi';
import { TransactionDetailScreen } from './TransactionDetailScreen';
import { duplicatePresetOf, editSpecOf, type RemoveResult, type TransactionApi, type TransactionData } from './transactionApi';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Singapore' } }));

afterEach(cleanup);
beforeEach(quietAccessibility);
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'getRecommendedTimeoutMillis').mockImplementation(async (ms: number) => ms);
});

const detail = (over: Partial<TransactionDetail> = {}): TransactionDetail => ({
  id: 't1', type: 'expense', status: 'confirmed', amountMinor: 45000, occurredAtMs: Date.UTC(2026, 10, 7, 13, 12), localDate: '2026-11-07', merchant: 'Swiggy', note: 'lunch', paymentMethod: 'upi',
  resolution: 'user_approved', removed: false, category: { id: 'cat_food', name: 'Food & Drinks', icon: 'ForkKnife', color: 'cat-rose' }, splitCount: 1,
  from: { id: 'a1', name: 'HDFC' }, to: null, sourceKind: 'manual', addedAtMs: Date.UTC(2026, 10, 7, 13, 12), timezoneId: 'Asia/Kolkata', openDuplicate: false, ...over,
});
const data = (d: TransactionDetail): TransactionData => ({ currency: 'INR', exponent: 2, locale: 'en-IN', detail: d });

function fakeApi(d: TransactionDetail | 'missing' = detail()) {
  const state = { d };
  const load = jest.fn<Promise<TransactionData | 'missing' | null>, [string]>(async () => (state.d === 'missing' ? 'missing' : data(state.d)));
  const remove = jest.fn<Promise<RemoveResult>, [string, 'delete' | 'reject']>(async () => ({ ok: true, value: { snapshot: { id: 't1' } as TxSnapshot } }));
  const restore = jest.fn<Promise<{ ok: boolean }>, [TxSnapshot]>(async () => ({ ok: true }));
  const api: TransactionApi = { load, remove, restore };
  return { api, load, remove, restore, state };
}

async function mountDetail(d: TransactionDetail | 'missing', over: { api?: TransactionApi; duplicateApi?: Parameters<typeof TransactionDetailScreen>[0]['duplicateApi'] } = {}) {
  const f = fakeApi(d);
  const qc = createQueryClient();
  const onBack = jest.fn();
  const onEdit = jest.fn();
  const onDuplicate = jest.fn();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <SheetHost>
              <TransactionDetailScreen transactionId="t1" onBack={onBack} onEdit={onEdit} onDuplicate={onDuplicate} api={over.api ?? f.api} duplicateApi={over.duplicateApi} />
            </SheetHost>
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
  return { ...f, r, onBack, onEdit, onDuplicate, unmount: () => act(() => r.unmount()) };
}

describe('TransactionDetailScreen (Story 3.4)', () => {
  it('shows the header as one TalkBack node and the rows: type, date, account, category, merchant, note, payment, status, source', async () => {
    const m = await mountDetail(detail());
    expect(host(m.r, 'detail-header').props.accessibilityLabel).toBe('Swiggy, spent 450 rupees, Food & Drinks, HDFC');
    const t = texts(m.r);
    expect(t).toEqual(expect.arrayContaining(['Swiggy', '₹450.00', 'Type', 'Expense', 'Account', 'HDFC', 'Category', 'Merchant', 'Note', 'lunch', 'Payment method', 'UPI', 'Status', 'Recorded', 'Source']));
    expect(t.some((x) => x.startsWith('Added by you · 7 Nov, '))).toBe(true);
    m.unmount();
  });

  it('a transfer reads From → To, neutral and unsigned; an income reads +', async () => {
    const tr = await mountDetail(detail({ type: 'transfer', merchant: null, category: null, from: { id: 'a1', name: 'HDFC' }, to: { id: 'a2', name: 'Cash' } }));
    expect(texts(tr.r)).toEqual(expect.arrayContaining(['Transfer', 'HDFC → Cash', '₹450.00']));
    expect(texts(tr.r).join(' ')).not.toMatch(/[+-]₹/);
    tr.unmount();
    const inc = await mountDetail(detail({ type: 'income', merchant: null, from: null, to: { id: 'a1', name: 'HDFC' }, category: { id: 'cat_in_salary', name: 'Salary', icon: 'Briefcase', color: 'cat-emerald' } }));
    expect(texts(inc.r)).toContain('+₹450.00');
    inc.unmount();
  });

  it('a manual entry offers Edit, Duplicate and Delete; a captured one offers Reject · Not mine and never the word Delete', async () => {
    const manual = await mountDetail(detail());
    expect(has(manual.r, 'detail-edit') && has(manual.r, 'detail-duplicate') && has(manual.r, 'detail-delete')).toBe(true);
    manual.unmount();
    const cap = await mountDetail(detail({ sourceKind: 'sms' }));
    expect(has(cap.r, 'detail-reject')).toBe(true);
    expect(has(cap.r, 'detail-delete')).toBe(false);
    expect(texts(cap.r)).toContain('Reject · Not mine');
    expect(texts(cap.r)).not.toContain('Delete');
    cap.unmount();
  });

  it('Delete removes at once, toasts Deleted with Undo, goes back, and Undo restores the snapshot', async () => {
    const m = await mountDetail(detail());
    await act(async () => fire(m.r, 'detail-delete'));
    await settle();
    expect(m.remove).toHaveBeenCalledWith('t1', 'delete');
    expect(m.onBack).toHaveBeenCalled();
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Deleted', 'Undo']));
    await act(async () => fire(m.r, 'toast-undo'));
    await settle();
    expect(m.restore).toHaveBeenCalledWith({ id: 't1' });
    m.unmount();
  });

  it('Reject on a captured entry toasts Rejected with Undo', async () => {
    const m = await mountDetail(detail({ sourceKind: 'sms' }));
    await act(async () => fire(m.r, 'detail-reject'));
    await settle();
    expect(m.remove).toHaveBeenCalledWith('t1', 'reject');
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Rejected', 'Undo']));
    m.unmount();
  });

  it('an entry removed meanwhile: Delete and Edit show "This entry was removed. Nothing was changed." and write nothing', async () => {
    const m = await mountDetail(detail());
    m.remove.mockResolvedValueOnce({ ok: false, code: 'ENTRY_REMOVED' });
    await act(async () => fire(m.r, 'detail-delete'));
    await settle();
    expect(texts(m.r)).toContain('This entry was removed. Nothing was changed.');
    expect(m.onBack).not.toHaveBeenCalled();
    m.state.d = detail({ removed: true });
    await act(async () => fire(m.r, 'detail-edit'));
    await settle();
    expect(m.onEdit).not.toHaveBeenCalled();
    expect(texts(m.r)).toContain('This entry was removed. Nothing was changed.');
    m.unmount();
  });

  it('Edit opens the editor on this entry with its type fixed; Duplicate opens a copy', async () => {
    const m = await mountDetail(detail());
    await act(async () => fire(m.r, 'detail-edit'));
    await settle();
    expect(m.onEdit).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 't1', kind: 'expense', amountMinor: 45000, categoryId: 'cat_food', accountId: 'a1', merchant: 'Swiggy', note: 'lunch', paymentMethod: 'upi' }));
    act(() => fire(m.r, 'detail-duplicate'));
    expect(m.onDuplicate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'expense', amountMinor: 45000, categoryId: 'cat_food', accountId: 'a1', merchant: 'Swiggy', note: 'lunch', copiedFrom: 't1' }));
    m.unmount();
  });

  it('a held entry shows "Possible duplicate — check it" with Keep both and Merge (the durable path)', async () => {
    const keepBoth = jest.fn(async () => ({ ok: true }));
    const duplicateApi = { duplicateInfo: jest.fn(async () => null), keepBoth, merge: jest.fn(async () => ({ ok: true })), undoResolution: jest.fn(async () => ({ ok: true })) };
    const m = await mountDetail(detail({ status: 'needs_review', resolution: null, openDuplicate: true }), { duplicateApi });
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Possible duplicate — check it', 'Keep both', 'Merge']));
    expect(texts(m.r)).toContain('Possible duplicate — check it');
    await act(async () => fire(m.r, 'keep-both-t1'));
    await settle();
    expect(keepBoth).toHaveBeenCalledWith('t1');
    m.unmount();
  });

  it('an entry that is not held has no Check line', async () => {
    const m = await mountDetail(detail());
    expect(has(m.r, 'detail-check')).toBe(false);
    m.unmount();
  });

  it('a missing entry says so', async () => {
    const m = await mountDetail('missing');
    expect(texts(m.r)).toContain('This entry is not here any more.');
    m.unmount();
  });

  it('editSpecOf and duplicatePresetOf only exist for expenses, incomes and transfers', () => {
    expect(editSpecOf(detail({ type: 'adjustment' }))).toBeNull();
    expect(duplicatePresetOf(detail({ type: 'opening_balance' }))).toBeNull();
    expect(editSpecOf(detail({ type: 'income', from: null, to: { id: 'a9', name: 'X' } }))?.accountId).toBe('a9');
    expect(editSpecOf(detail({ type: 'transfer', category: null, from: { id: 'a1', name: 'A' }, to: { id: 'a2', name: 'B' } }))).toMatchObject({ kind: 'transfer', accountId: 'a1', toAccountId: 'a2' });
  });
});

describe('editing and duplicating in the Add sheet', () => {
  const spec = { transactionId: 't1', kind: 'expense' as const, amountMinor: 1250, categoryId: 'cat_food', accountId: 'a1', toAccountId: null, merchant: 'Kopi', note: 'with Sam', paymentMethod: 'upi' as const, occurredAtMs: Date.UTC(2026, 10, 7, 1, 15) };

  it('opens with the type fixed, the amount, category, account and details filled; no Save & add another', async () => {
    const m = await mountReady({}, undefined, undefined, undefined, spec);
    expect(has(m.r, 'kind-income')).toBe(false);
    expect(has(m.r, 'kind-expense')).toBe(true);
    expect(has(m.r, 'save-another')).toBe(false);
    expect(texts(m.r)).toContain('S$12.50');
    expect(host(m.r, 'merchant-input').props.value).toBe('Kopi');
    expect(host(m.r, 'note-input').props.value).toBe('with Sam');
    expect(host(m.r, 'date-input').props.value).toBe('2026-11-07');
    expect(host(m.r, 'time-input').props.value).toBe('09:15');
  });

  it('Save changes the entry (not adds one), toasts Saved with Undo, and Undo restores the snapshot', async () => {
    const m = await mountReady({}, undefined, undefined, undefined, spec);
    tap(m.r, '4');
    await act(async () => fire(m.r, 'save'));
    await settle();
    expect(m.record).not.toHaveBeenCalled();
    expect(m.editTx).toHaveBeenCalledWith('t1', { entry: expect.objectContaining({ amountMinor: 1254, categoryId: 'cat_food', accountId: 'a1', merchant: 'Kopi', note: 'with Sam', paymentMethod: 'upi', occurredAtMs: Date.UTC(2026, 10, 7, 1, 15) }) });
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Saved', 'Undo']));
    await act(async () => fire(m.r, 'toast-undo'));
    await settle();
    expect(m.restoreTransaction).toHaveBeenCalledWith({ id: 'e1' });
  });

  it('an empty amount shows "Error: amount required", keeps the input and writes nothing', async () => {
    const m = await mountReady({}, undefined, undefined, undefined, spec);
    for (let i = 0; i < 6; i++) act(() => fire(m.r, 'key-delete'));
    await act(async () => fire(m.r, 'save'));
    expect(texts(m.r)).toContain('Error: amount required');
    expect(m.editTx).not.toHaveBeenCalled();
    expect(host(m.r, 'merchant-input').props.value).toBe('Kopi');
  });

  it('a removed entry says so in the sheet and changes nothing', async () => {
    const m = await mountReady({}, undefined, undefined, undefined, spec);
    m.editTx.mockResolvedValueOnce({ ok: false, code: 'ENTRY_REMOVED' });
    await act(async () => fire(m.r, 'save'));
    await settle();
    expect(texts(m.r)).toContain('This entry was removed. Nothing was changed.');
    expect(m.close).not.toHaveBeenCalled();
  });

  it('Duplicate copies amount, category, account, merchant and note, and saves through the pipeline with copiedFrom', async () => {
    const m = await mountReady({}, undefined, undefined, { kind: 'expense', accountId: 'a1', amountMinor: 6000, categoryId: 'cat_transport', merchant: 'Metro', note: null, copiedFrom: 't9' });
    expect(texts(m.r)).toContain('S$60.00');
    expect(host(m.r, 'category-cat_transport').props.accessibilityState).toMatchObject({ selected: true });
    await act(async () => fire(m.r, 'save'));
    await settle();
    expect(m.record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'expense', amountMinor: 6000, categoryId: 'cat_transport', accountId: 'a1', merchant: 'Metro', copiedFrom: 't9' }));
  });
});

describe('rows open the entry and carry TalkBack actions', () => {
  const row = (id: string, over: Partial<ActivityRow> = {}): ActivityRow => ({
    id, kind: 'expense', amountMinor: 45000, localDate: '2026-11-07', merchant: 'Swiggy', categoryName: 'Food & Drinks', categoryIcon: 'ForkKnife', categoryColor: 'cat-rose', accountName: 'DBS', ...over,
  });
  const act2: ActivityData = { currency: 'SGD', locale: 'en-SG', today: '2026-11-07', days: groupByDay([row('a'), row('c', { captured: true })]), hasMore: false };

  it('tapping a row opens it; Recategorise and Delete are custom actions, Reject for a captured entry', async () => {
    const onOpen = jest.fn();
    const onDelete = jest.fn();
    const onRecat = jest.fn();
    const f = await mountReady();
    const qc = createQueryClient();
    const api: ActivityApi = { load: async () => act2 };
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <QueryClientProvider client={qc}>
          <ThemeProvider>
            <ToastHost bottomOffset={0}>
              <SheetHost>
                <ActivityScreen api={api} duplicateApi={f.api} onAccounts={() => undefined} onProfile={() => undefined} onAdd={() => undefined} onOpen={onOpen} onDeleteRow={onDelete} onRecategorise={onRecat} />
              </SheetHost>
            </ToastHost>
          </ThemeProvider>
        </QueryClientProvider>,
      );
    });
    await settle();
    const rowOf = (id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === `activity-row-${id}`)[0]!;
    expect(rowOf('a').props.accessibilityActions.map((a: { label: string }) => a.label)).toEqual(['Recategorise', 'Delete']);
    expect(rowOf('c').props.accessibilityActions.map((a: { label: string }) => a.label)).toEqual(['Recategorise', 'Reject · Not mine']);
    await act(async () => r.root.findAll((n) => n.props.testID === 'activity-row-a' && typeof n.props.onPress === 'function')[0]!.props.onPress());
    expect(onOpen).toHaveBeenCalledWith('a');
    act(() => rowOf('a').props.onAccessibilityAction({ nativeEvent: { actionName: 'delete' } }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    act(() => rowOf('a').props.onAccessibilityAction({ nativeEvent: { actionName: 'recategorise' } }));
    expect(onRecat).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    act(() => r.unmount());
    void Text;
  });
});
