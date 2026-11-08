import { AccessibilityInfo } from 'react-native';
import { act, type ReactTestRenderer } from 'react-test-renderer';
import { useUiStore } from '../../shared/state/uiStore';
import { account, cleanup, fire, has, host, mountReady, quietAccessibility, settle, tap, texts } from './testKit';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Singapore' } }));

let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 400, height: 800, scale: 2, fontScale: mockFontScale }),
}));

afterEach(async () => {
  await cleanup();
  mockFontScale = 1;
});
beforeEach(quietAccessibility);

describe('segments', () => {
  it('are a radio group "Entry type" with "n of 3"', async () => {
    const { r } = await mountReady();
    const group = r.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'radiogroup')[0]!;
    expect(group.props.accessibilityLabel).toBe('Entry type');
    for (const [i, k] of ['expense', 'income', 'transfer'].entries()) {
      expect(host(r, `kind-${k}`).props.accessibilityRole).toBe('radio');
      expect(host(r, `kind-${k}`).props.accessibilityHint).toBe(`Option ${i + 1} of 3`);
    }
  });

  it('become a vertical list at fontScale 1.3', async () => {
    mockFontScale = 1.3;
    const { r } = await mountReady();
    const group = r.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'radiogroup')[0]!;
    expect(group.props.style.flexDirection).toBe('column');
  });
});

describe('Income', () => {
  it('keeps the amount, shows income categories and "Received in"', async () => {
    const { r } = await mountReady();
    tap(r, '12.50');
    act(() => fire(r, 'kind-income'));
    await settle();
    expect(texts(r)).toEqual(expect.arrayContaining(['Salary', 'Received in', '+S$12.50']));
    expect(has(r, 'category-cat_food')).toBe(false);
  });

  it('saves S$4,200 in Salary with a note', async () => {
    const { r, record } = await mountReady();
    act(() => fire(r, 'kind-income'));
    await settle();
    tap(r, '4200');
    act(() => fire(r, 'category-cat_in_salary'));
    act(() => fire(r, 'details-toggle'));
    act(() => fire(r, 'note-input', 'onChangeText', 'Nov'));
    await act(async () => fire(r, 'save'));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'income', amountMinor: 420000, categoryId: 'cat_in_salary', note: 'Nov' }));
  });
});

describe('Transfer', () => {
  const toTransfer = async (r: ReactTestRenderer) => {
    act(() => fire(r, 'kind-transfer'));
    await settle();
  };

  it('announces, hides categories, shows From and To and keeps the amount', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const { r } = await mountReady();
    tap(r, '200');
    await toTransfer(r);
    expect(announce).toHaveBeenCalledWith('Transfer selected. From and To accounts shown');
    expect(has(r, 'category-chips')).toBe(false);
    expect(texts(r)).toEqual(expect.arrayContaining(['From', 'To', 'S$200.00']));
    expect(has(r, 'to-option-a2')).toBe(true);
  });

  it('saves From to To with the typed amount and closes with Saved and Undo', async () => {
    const { r, recordTransfer, close } = await mountReady();
    tap(r, '200');
    await toTransfer(r);
    await act(async () => fire(r, 'save'));
    await settle();
    expect(recordTransfer).toHaveBeenCalledWith({ submissionId: 'sub-1', amountMinor: 20000, fromAccountId: 'a1', toAccountId: 'a2' });
    expect(close).toHaveBeenCalled();
    expect(texts(r)).toEqual(expect.arrayContaining(['Saved', 'Undo']));
  });

  it('sends a fee with its category (default Other)', async () => {
    const { r, recordTransfer } = await mountReady();
    tap(r, '200');
    await toTransfer(r);
    act(() => fire(r, 'details-toggle'));
    act(() => fire(r, 'fee-input', 'onChangeText', '2'));
    await act(async () => fire(r, 'save'));
    expect(recordTransfer).toHaveBeenCalledWith(expect.objectContaining({ fee: { amountMinor: 200, categoryId: 'cat_other' } }));
  });

  it('a fee that is not a number shows an error and writes nothing', async () => {
    const { r, recordTransfer } = await mountReady();
    tap(r, '200');
    await toTransfer(r);
    act(() => fire(r, 'details-toggle'));
    act(() => fire(r, 'fee-input', 'onChangeText', 'abc'));
    await act(async () => fire(r, 'save'));
    expect(has(r, 'fee-error')).toBe(true);
    expect(recordTransfer).not.toHaveBeenCalled();
  });

  it('with one account offers + New account and refuses "Choose two different accounts", keeping the input', async () => {
    const onNew = jest.fn();
    const { r, recordTransfer } = await mountReady({ accounts: [account('a1', 'DBS')] }, undefined, onNew);
    tap(r, '200');
    await toTransfer(r);
    act(() => fire(r, 'to-new-account'));
    expect(onNew).toHaveBeenCalled();
    await act(async () => fire(r, 'save'));
    expect(texts(r)).toContain('Choose two different accounts');
    expect(recordTransfer).not.toHaveBeenCalled();
    expect(texts(r)).toContain('S$200.00');
  });

  it('warns once when above the balance on record, then saves on the next Save', async () => {
    const poor = account('a1', 'DBS', { balanceNotSet: false, postingsMinor: 5000 });
    const { r, recordTransfer } = await mountReady({ accounts: [poor, account('a2', 'Cash')] });
    tap(r, '200');
    await toTransfer(r);
    await act(async () => fire(r, 'save'));
    expect(has(r, 'transfer-warning')).toBe(true);
    expect(recordTransfer).not.toHaveBeenCalled();
    await act(async () => fire(r, 'save'));
    expect(recordTransfer).toHaveBeenCalledTimes(1);
  });

  it('does not warn when the From balance is not set', async () => {
    const { r, recordTransfer } = await mountReady();
    tap(r, '200');
    await toTransfer(r);
    await act(async () => fire(r, 'save'));
    expect(has(r, 'transfer-warning')).toBe(false);
    expect(recordTransfer).toHaveBeenCalled();
  });

  it('shows the blocked message and keeps the input on INSUFFICIENT_FUNDS', async () => {
    const m = await mountReady({ blockTransfers: true });
    m.recordTransfer.mockResolvedValueOnce({ ok: false, code: 'INSUFFICIENT_FUNDS' });
    tap(m.r, '200');
    await toTransfer(m.r);
    await act(async () => fire(m.r, 'save'));
    expect(texts(m.r).join(' ')).toContain('more than the balance');
    expect(texts(m.r)).toContain('S$200.00');
    expect(m.close).not.toHaveBeenCalled();
  });

  it('Undo removes the transfer and its fee', async () => {
    const m = await mountReady();
    m.recordTransfer.mockResolvedValueOnce({ ok: true, value: { transactionId: 'tr1', feeTransactionId: 'fee1' } });
    tap(m.r, '200');
    await toTransfer(m.r);
    await act(async () => fire(m.r, 'save'));
    await settle();
    await act(async () => fire(m.r, 'toast-undo'));
    await settle();
    expect(m.remove).toHaveBeenCalledWith('tr1');
    expect(m.remove).toHaveBeenCalledWith('fee1');
  });
});

describe('opened from an account (Story 2.3)', () => {
  it('Move money opens as a transfer with From set to that account and the amount empty, even over an old draft', async () => {
    useUiStore.setState({ addDraft: { kind: 'expense', typedText: '99', categoryId: 'cat_food' } });
    const { r, recordTransfer } = await mountReady({}, undefined, undefined, { kind: 'transfer', accountId: 'a2' });
    expect(texts(r)).toEqual(expect.arrayContaining(['From', 'To']));
    expect(has(r, 'category-cat_food')).toBe(false);
    expect(texts(r).join('|')).not.toContain('S$99');
    tap(r, '20');
    await act(async () => fire(r, 'save'));
    expect(recordTransfer).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 2000, fromAccountId: 'a2', toAccountId: 'a1' }));
  });

  it('Add an expense opens as an expense paid from that account', async () => {
    const { r, record } = await mountReady({}, undefined, undefined, { kind: 'expense', accountId: 'a2' });
    tap(r, '5');
    act(() => fire(r, 'category-cat_food'));
    await act(async () => fire(r, 'save'));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'expense', accountId: 'a2' }));
  });
});

describe('Pay card bill (Story 2.7)', () => {
  const dbs = account('a1', 'DBS', { balanceNotSet: false, postingsMinor: 3120000 });
  const card = account('c1', 'HDFC Card', { type: 'card', icon: 'CreditCard', balanceNotSet: false, postingsMinor: -1245000 });
  const pay = { kind: 'transfer' as const, accountId: 'a1', toAccountId: 'c1', lockTo: true, owedMinor: 1245000 };

  it('opens as a transfer with To locked to the card and the amount ready; saving writes From DBS To the card', async () => {
    const { r, recordTransfer } = await mountReady({ accounts: [dbs, card] }, undefined, undefined, { ...pay, amountMinor: 820000 });
    expect(has(r, 'to-locked')).toBe(true);
    expect(has(r, 'to-option-a1')).toBe(false);
    expect(texts(r)).toEqual(expect.arrayContaining(['To', 'HDFC Card', 'S$8,200.00']));
    await act(async () => fire(r, 'save'));
    expect(recordTransfer).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 820000, fromAccountId: 'a1', toAccountId: 'c1' }));
  });

  it('From offers only asset accounts, never the card itself', async () => {
    const { r } = await mountReady({ accounts: [dbs, card, account('a2', 'Cash wallet')] }, undefined, undefined, { ...pay, amountMinor: 820000 });
    act(() => fire(r, 'account-chip'));
    expect(has(r, 'account-option-a2')).toBe(true);
    expect(has(r, 'account-option-c1')).toBe(false);
  });

  it('paying more than is owed says so once, then goes ahead on the next Save', async () => {
    const { r, recordTransfer } = await mountReady({ accounts: [dbs, card] }, undefined, undefined, { ...pay, amountMinor: 1500000 });
    await act(async () => fire(r, 'save'));
    expect(recordTransfer).not.toHaveBeenCalled();
    expect(host(r, 'owed-warning').props.children).toBe('This is more than you owe. The extra shows as credit on the card. Tap Save again to continue.');
    await act(async () => fire(r, 'save'));
    expect(recordTransfer).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 1500000 }));
  });

  it('with nothing owed the amount is empty and the hint says so', async () => {
    const { r } = await mountReady({ accounts: [dbs, card] }, undefined, undefined, { ...pay, amountMinor: null, owedMinor: 0, hint: 'Nothing owed on this card right now' });
    expect(texts(r)).toContain('Nothing owed on this card right now');
    tap(r, '5');
    expect(has(r, 'preset-hint')).toBe(false);
  });

  it('with no asset account nothing is saved until From is set: "Error: choose where the money came from"', async () => {
    const { r, recordTransfer } = await mountReady({ accounts: [card], defaultAccountId: null }, undefined, undefined, { ...pay, accountId: null, amountMinor: 820000 });
    await act(async () => fire(r, 'save'));
    expect(texts(r)).toContain('Error: choose where the money came from');
    expect(host(r, 'from-error').props.accessibilityRole).toBe('alert');
    expect(recordTransfer).not.toHaveBeenCalled();
  });

  it('the over-balance warning from Story 1.15 still applies to the payer', async () => {
    const poor = account('a1', 'DBS', { balanceNotSet: false, postingsMinor: 100000 });
    const { r, recordTransfer } = await mountReady({ accounts: [poor, card] }, undefined, undefined, { ...pay, amountMinor: 820000 });
    await act(async () => fire(r, 'save'));
    expect(recordTransfer).not.toHaveBeenCalled();
    expect(has(r, 'transfer-warning')).toBe(true);
  });
});
