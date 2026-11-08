import { TextInput } from 'react-native';
import { act, type ReactTestRenderer } from 'react-test-renderer';
import { typedAmountLabel } from '../../shared/a11y/labels';
import { useUiStore } from '../../shared/state/uiStore';
import { KEY_SIZE } from './Keypad';
import { cleanup, fakeApi, find, fire, has, host, mount, mountReady, quietAccessibility, settle, tap, texts, unmountNow } from './testKit';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Singapore' } }));

afterEach(cleanup);
beforeEach(quietAccessibility);

const amountText = (r: Parameters<typeof host>[0]) => host(r, 'typed-amount');

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
    unmountNow(first.r);

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
