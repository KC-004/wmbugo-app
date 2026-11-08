import { AccessibilityInfo, Text, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { mapCategoryRows, rankCategories, SEED_CATEGORIES, type AccountRow, type ManualEntry, type TransferInput } from '@wmbugo/core';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { EMPTY_DRAFT, useUiStore } from '../../shared/state/uiStore';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { typedAmountLabel } from '../../shared/a11y/labels';
import { AddSheet } from './AddSheet';
import type { AddApi, AddData, AddKind } from './addApi';
import { KEY_SIZE } from './Keypad';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Singapore' } }));

const live: ReactTestRenderer[] = [];
const clients: ReturnType<typeof createQueryClient>[] = [];
afterEach(async () => {
  await act(async () => new Promise((res) => setTimeout(res, 0)));
  for (const r of live.splice(0)) act(() => r.unmount());
  for (const c of clients.splice(0)) c.clear();
  jest.restoreAllMocks();
  useUiStore.setState({ addDraft: EMPTY_DRAFT });
});
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
  jest.spyOn(AccessibilityInfo, 'getRecommendedTimeoutMillis').mockImplementation(async (ms: number) => ms);
});

const find = (r: ReactTestRenderer, testID: string, handler: string) =>
  r.root.findAll((n) => n.props.testID === testID && typeof n.props[handler] === 'function')[0]!;
const host = (r: ReactTestRenderer, testID: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === testID)[0]!;
const fire = (r: ReactTestRenderer, testID: string, handler = 'onPress', ...args: unknown[]) => find(r, testID, handler).props[handler](...args);
const settle = async () => {
  for (let i = 0; i < 3; i++) await act(async () => new Promise((res) => setTimeout(res, 0)));
};
const has = (r: ReactTestRenderer, testID: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === testID).length > 0;
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
const tap = (r: ReactTestRenderer, keys: string) => {
  for (const k of keys) act(() => fire(r, k === '.' ? 'key-decimal' : `key-${k}`));
};
const amountText = (r: ReactTestRenderer) => r.root.findAll((n) => n.props.testID === 'typed-amount')[0]!;

const account = (id: string, name: string): AccountRow => ({ id, name, type: 'bank', icon: 'Bank', colorToken: 'cat-indigo', sortOrder: 0, status: 'active', balanceNotSet: true, postingsMinor: 0 });
const cats = (kind: AddKind) => mapCategoryRows(SEED_CATEGORIES.filter((c) => c.kind === (kind === 'income' ? 'income' : 'expense')).map((c, i) => [c.id, c.name, c.kind, c.budgetType, c.icon, c.color, i]));

function fakeApi(over: Partial<AddData> = {}, counts = new Map<string, number>()) {
  const record = jest.fn<Promise<{ ok: true; value: { transactionId: string; accountId: string } } | { ok: false; code: string }>, [ManualEntry]>(async () => ({
    ok: true,
    value: { transactionId: 'tx1', accountId: 'a1' },
  }));
  const remove = jest.fn(async (...ids: string[]) => ({ ok: ids.length >= 0 }));
  const recordTransfer = jest.fn<Promise<{ ok: true; value: { transactionId: string; feeTransactionId: string | null } } | { ok: false; code: string }>, [TransferInput]>(async () => ({ ok: true, value: { transactionId: 'tr1', feeTransactionId: null } }));
  const defaultAccountFor = jest.fn(async (c: string) => (c === 'cat_transport' ? 'a2' : 'a1'));
  const load = jest.fn(async (kind: AddKind): Promise<AddData> => {
    const categories = cats(kind);
    return {
      currency: 'SGD',
      exponent: 2,
      locale: 'en-SG',
      timezoneId: 'Asia/Singapore',
      categories,
      quick: rankCategories(categories, counts),
      accounts: [account('a1', 'DBS'), account('a2', 'Cash wallet')],
      defaultAccountId: 'a1',
      blockTransfers: false,
      ...over,
    };
  });
  const api: AddApi = { load, defaultAccountFor, record, recordTransfer, remove };
  return { api, record, recordTransfer, remove, load, defaultAccountFor };
}

function mount(api: AddApi, close = jest.fn()) {
  const qc = createQueryClient();
  clients.push(qc);
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <AddSheet api={api} close={close} now={() => Date.UTC(2026, 10, 8, 10, 0, 0)} />
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  return { r, close, qc };
}

async function mountReady(over: Partial<AddData> = {}, counts?: Map<string, number>) {
  const f = fakeApi(over, counts);
  const m = mount(f.api);
  await settle();
  return { ...f, ...m };
}

describe('Add sheet layout', () => {
  it('shows Expense selected, Income, quick categories, account, amount and keypad; no capture chips or CSV', async () => {
    const { r } = await mountReady();
    expect(host(r, 'kind-expense').props.accessibilityState.selected).toBe(true);
    expect(host(r, 'kind-income').props.accessibilityState.selected).toBe(false);
    expect(has(r, 'keypad')).toBe(true);
    expect(has(r, 'account-chip')).toBe(true);
    const all = texts(r).join('|').toLowerCase();
    for (const banned of ['snap receipt', 'share from upi', 'csv', 'coming soon']) expect(all).not.toContain(banned);
  });

  it('autofocuses the hardware-key input and keeps the soft keyboard closed', async () => {
    const { r } = await mountReady();
    const input = r.root.findAll((n) => n.props.testID === 'amount-input')[0]!;
    expect(input.props.autoFocus).toBe(true);
    expect(input.props.showSoftInputOnFocus).toBe(false);
  });

  it('lists quick categories in seed order for a new profile, by use count otherwise, and More shows the rest', async () => {
    const a = await mountReady();
    const quickIds = (r: ReactTestRenderer) => r.root.findAll((n) => typeof n.type === 'string' && /^category-cat_/.test(String(n.props.testID))).map((n) => n.props.testID);
    expect(quickIds(a.r).slice(0, 3)).toEqual(['category-cat_food', 'category-cat_groceries', 'category-cat_transport']);
    expect(quickIds(a.r)).toHaveLength(6);
    act(() => fire(a.r, 'category-more'));
    expect(quickIds(a.r)).toHaveLength(14);
    expect(has(a.r, 'category-cat_uncategorised')).toBe(true);

    const b = await mountReady({}, new Map([['cat_travel', 9]]));
    expect(quickIds(b.r)[0]).toBe('category-cat_travel');
  });

  it('does not reorder the chips while open, even if the use counts change', async () => {
    const counts = new Map<string, number>();
    const f = fakeApi({}, counts);
    const { r } = mount(f.api);
    await settle();
    const order = () => r.root.findAll((n) => typeof n.type === 'string' && /^category-cat_/.test(String(n.props.testID))).map((n) => n.props.testID);
    const before = order();
    counts.set('cat_travel', 50);
    act(() => fire(r, 'category-cat_food'));
    await settle();
    expect(order()).toEqual(before);
    expect(f.load).toHaveBeenCalledTimes(1);
  });
});

describe('keypad', () => {
  it('typing 12.50 on an SGD profile reads S$12.50 as a polite live region', async () => {
    const { r } = await mountReady();
    tap(r, '12.50');
    const node = amountText(r);
    expect(node.props.accessibilityLiveRegion).toBe('polite');
    expect(node.props.accessibilityLabel).toBe('Amount 12 point 50 Singapore dollars');
    expect(texts(r)).toContain('S$12.50');
  });

  it('blocks a third decimal instead of rounding', async () => {
    const { r } = await mountReady();
    tap(r, '12.509');
    expect(texts(r)).toContain('S$12.50');
  });

  it('keys are at least 56dp, labelled 1 to 0, decimal point and Delete', async () => {
    const { r } = await mountReady();
    const label = (id: string) => host(r, id).props.accessibilityLabel;
    for (const d of '0123456789') expect(label(`key-${d}`)).toBe(d);
    expect(label('key-decimal')).toBe('Decimal point');
    expect(label('key-delete')).toBe('Delete');
    expect(KEY_SIZE).toBeGreaterThanOrEqual(56);
  });

  it('Delete removes one character; long-press Delete and the visible Clear both clear', async () => {
    const { r } = await mountReady();
    tap(r, '123');
    act(() => fire(r, 'key-delete'));
    expect(texts(r)).toContain('S$12.00');
    act(() => fire(r, 'key-delete', 'onLongPress'));
    expect(texts(r)).toContain('S$0.00');
    tap(r, '45');
    act(() => fire(r, 'key-clear'));
    expect(texts(r)).toContain('S$0.00');
  });

  it('hides the decimal key for a currency with no minor unit', async () => {
    const { r } = await mountReady({ currency: 'JPY' as never, exponent: 0 });
    expect(r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'key-decimal')).toHaveLength(0);
    tap(r, '500');
  });

  it('shows the locale decimal separator on the key', async () => {
    const { r } = await mountReady({ locale: 'de-DE' });
    const key = r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'key-decimal')[0]!;
    expect(key).toBeDefined();
    expect(texts(r)).toContain(',');
  });

  it('hardware number keys and Backspace work', async () => {
    const { r } = await mountReady();
    const press = (key: string) => act(() => fire(r, 'amount-input', 'onKeyPress', { nativeEvent: { key } }));
    ['1', '2', '.', '5'].forEach(press);
    expect(texts(r)).toContain('S$12.50');
    press('Backspace');
    expect(texts(r)).toContain('S$12.00');
    press('x');
    expect(texts(r)).toContain('S$12.00');
  });

  it('speaks a typed amount', () => {
    expect(typedAmountLabel('', 'SGD')).toBe('0 Singapore dollars');
    expect(typedAmountLabel('12.', 'SGD')).toBe('12 point Singapore dollars');
    expect(typedAmountLabel('12.5', 'SGD')).toBe('12 point 5 Singapore dollars');
  });
});

describe('saving', () => {
  it('Save writes one expense with the typed minor amount, closes, and toasts Saved with Undo', async () => {
    const { r, record, close } = await mountReady();
    tap(r, '12.50');
    act(() => fire(r, 'category-cat_food'));
    await settle();
    await act(async () => fire(r, 'save'));
    await settle();
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({ kind: 'expense', amountMinor: 1250, categoryId: 'cat_food', accountId: 'a1' });
    expect(close).toHaveBeenCalledTimes(1);
    expect(texts(r)).toEqual(expect.arrayContaining(['Saved', 'Undo']));
  });

  it('Undo removes the saved entry', async () => {
    const { r, remove } = await mountReady();
    tap(r, '5');
    act(() => fire(r, 'category-cat_food'));
    await act(async () => fire(r, 'save'));
    await settle();
    await act(async () => fire(r, 'toast-undo'));
    await settle();
    expect(remove).toHaveBeenCalledWith('tx1');
  });

  it('the account follows the category until Mei picks one herself', async () => {
    const f = await mountReady();
    act(() => fire(f.r, 'category-cat_transport'));
    await settle();
    expect(host(f.r, 'account-chip').props.accessibilityLabel).toBe('Cash wallet');
    act(() => fire(f.r, 'account-chip'));
    act(() => fire(f.r, 'account-option-a1'));
    act(() => fire(f.r, 'category-cat_transport'));
    await settle();
    expect(host(f.r, 'account-chip').props.accessibilityLabel).toBe('DBS');
    tap(f.r, '3');
    await act(async () => fire(f.r, 'save'));
    expect(f.record).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'a1' }));
  });

  it('with no account the chip says Cash and Save sends accountId null so Cash is created', async () => {
    const f = await mountReady({ accounts: [], defaultAccountId: null });
    expect(host(f.r, 'account-chip').props.accessibilityLabel).toBe('Cash');
    tap(f.r, '7');
    act(() => fire(f.r, 'category-cat_food'));
    await act(async () => fire(f.r, 'save'));
    expect(f.record).toHaveBeenCalledWith(expect.objectContaining({ accountId: null }));
  });

  it('an empty or zero amount shows Error: amount required, focuses the amount and writes nothing', async () => {
    const focus = (TextInput as unknown as { prototype: { focus: jest.Mock } }).prototype.focus;
    const { r, record, close } = await mountReady();
    act(() => fire(r, 'category-cat_food'));
    focus.mockClear();
    await act(async () => fire(r, 'save'));
    expect(texts(r)).toContain('Error: amount required');
    expect(focus).toHaveBeenCalled();
    tap(r, '0');
    await act(async () => fire(r, 'save'));
    expect(record).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    tap(r, '5');
    expect(has(r, 'amount-error')).toBe(false);
  });

  it('asks for a category and keeps the amount', async () => {
    const { r, record } = await mountReady();
    tap(r, '9');
    await act(async () => fire(r, 'save'));
    expect(texts(r)).toContain('Error: category required');
    expect(record).not.toHaveBeenCalled();
    expect(texts(r)).toContain('S$9.00');
  });

  it('a failed save keeps everything and says nothing was saved', async () => {
    const f = fakeApi();
    f.record.mockResolvedValueOnce({ ok: false, code: 'INVARIANT_VIOLATED' });
    const { r, close } = mount(f.api);
    await settle();
    tap(r, '9');
    act(() => fire(r, 'category-cat_food'));
    await act(async () => fire(r, 'save'));
    expect(texts(r).join(' ')).toContain('Nothing was saved');
    expect(close).not.toHaveBeenCalled();
    expect(texts(r)).toContain('S$9.00');
  });

  it('a double tap on Save writes once', async () => {
    const f = fakeApi();
    let release!: () => void;
    f.record.mockImplementationOnce(() => new Promise((res) => { release = () => res({ ok: true, value: { transactionId: 't', accountId: 'a1' } }); }));
    const { r } = mount(f.api);
    await settle();
    tap(r, '4');
    act(() => fire(r, 'category-cat_food'));
    await act(async () => { fire(r, 'save'); fire(r, 'save'); });
    await act(async () => release());
    await settle();
    expect(f.record).toHaveBeenCalledTimes(1);
  });

  it('Save & add another keeps the sheet open, clears the amount and keeps the type', async () => {
    const { r, record, close } = await mountReady();
    act(() => fire(r, 'kind-income'));
    await settle();
    tap(r, '20');
    act(() => fire(r, 'category-cat_in_salary'));
    await act(async () => fire(r, 'save-another'));
    await settle();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'income', amountMinor: 2000 }));
    expect(close).not.toHaveBeenCalled();
    expect(texts(r)).toContain('+S$0.00');
    expect(host(r, 'kind-income').props.accessibilityState.selected).toBe(true);
    expect(texts(r)).toContain('Saved');
  });

  it('optional details are sent: merchant, note, payment method and a chosen date and time', async () => {
    const { r, record } = await mountReady();
    tap(r, '8');
    act(() => fire(r, 'category-cat_food'));
    act(() => fire(r, 'details-toggle'));
    act(() => fire(r, 'merchant-input', 'onChangeText', 'Kopi'));
    act(() => fire(r, 'note-input', 'onChangeText', 'with Sam'));
    act(() => fire(r, 'payment-upi'));
    act(() => fire(r, 'date-input', 'onChangeText', '2026-11-07'));
    act(() => fire(r, 'time-input', 'onChangeText', '09:15'));
    await act(async () => fire(r, 'save'));
    expect(record).toHaveBeenCalledWith({
      kind: 'expense',
      amountMinor: 800,
      categoryId: 'cat_food',
      accountId: 'a1',
      merchant: 'Kopi',
      note: 'with Sam',
      paymentMethod: 'upi',
      occurredAtMs: Date.UTC(2026, 10, 7, 1, 15),
    });
  });

  it('an impossible date shows an error and writes nothing', async () => {
    const { r, record } = await mountReady();
    tap(r, '8');
    act(() => fire(r, 'category-cat_food'));
    act(() => fire(r, 'details-toggle'));
    act(() => fire(r, 'date-input', 'onChangeText', '2026-02-31'));
    await act(async () => fire(r, 'save'));
    expect(texts(r)).toContain('Error: check the date and time');
    expect(record).not.toHaveBeenCalled();
  });

  it('prefills the date and time with now in the profile timezone and leaves them out when untouched', async () => {
    const { r, record } = await mountReady();
    act(() => fire(r, 'details-toggle'));
    expect(find(r, 'date-input', 'onChangeText').props.value).toBe('2026-11-08');
    expect(find(r, 'time-input', 'onChangeText').props.value).toBe('18:00');
    tap(r, '2');
    act(() => fire(r, 'category-cat_food'));
    await act(async () => fire(r, 'save'));
    expect(record.mock.calls[0]![0]).not.toHaveProperty('occurredAtMs');
  });
});

describe('draft', () => {
  it('restores amount, type and category after a dismiss, from memory only', async () => {
    const first = await mountReady();
    act(() => fire(first.r, 'kind-income'));
    await settle();
    tap(first.r, '45');
    act(() => fire(first.r, 'category-cat_in_gifts'));
    await settle();
    act(() => first.r.unmount());
    live.splice(live.indexOf(first.r), 1);

    const second = await mountReady();
    expect(host(second.r, 'kind-income').props.accessibilityState.selected).toBe(true);
    expect(texts(second.r)).toContain('+S$45.00');
    expect(host(second.r, 'category-cat_in_gifts').props.accessibilityState.selected).toBe(true);
  });

  it('is discarded by Save and by Clear', async () => {
    const a = await mountReady();
    tap(a.r, '6');
    act(() => fire(a.r, 'category-cat_food'));
    await act(async () => fire(a.r, 'save'));
    await settle();
    expect(useUiStore.getState().addDraft).toEqual({ kind: 'expense', typedText: '', categoryId: null });

    useUiStore.setState({ addDraft: { kind: 'expense', typedText: '12', categoryId: 'cat_food' } });
    const b = await mountReady();
    act(() => fire(b.r, 'key-clear'));
    await settle();
    expect(useUiStore.getState().addDraft).toEqual({ kind: 'expense', typedText: '', categoryId: null });
  });
});
