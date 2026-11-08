import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { mapCategoryRows, rankCategories, SEED_CATEGORIES, type AccountRow, type TransferInput } from '@wmbugo/core';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { EMPTY_DRAFT, useUiStore } from '../../shared/state/uiStore';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { AddSheet } from './AddSheet';
import type { AddApi, AddData, AddKind } from './addApi';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Singapore' } }));

let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 400, height: 800, scale: 2, fontScale: mockFontScale }),
}));

const live: ReactTestRenderer[] = [];
const clients: ReturnType<typeof createQueryClient>[] = [];
afterEach(async () => {
  await act(async () => new Promise((res) => setTimeout(res, 0)));
  for (const r of live.splice(0)) act(() => r.unmount());
  for (const c of clients.splice(0)) c.clear();
  jest.restoreAllMocks();
  useUiStore.setState({ addDraft: EMPTY_DRAFT });
  mockFontScale = 1;
});
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
  jest.spyOn(AccessibilityInfo, 'getRecommendedTimeoutMillis').mockImplementation(async (ms: number) => ms);
});

const fire = (r: ReactTestRenderer, id: string, handler = 'onPress', ...args: unknown[]) =>
  r.root.findAll((n) => n.props.testID === id && typeof n.props[handler] === 'function')[0]!.props[handler](...args);
const host = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id)[0]!;
const has = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id).length > 0;
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
const settle = async () => {
  for (let i = 0; i < 3; i++) await act(async () => new Promise((res) => setTimeout(res, 0)));
};
const tap = (r: ReactTestRenderer, keys: string) => {
  for (const k of keys) act(() => fire(r, k === '.' ? 'key-decimal' : `key-${k}`));
};

const account = (id: string, name: string, over: Partial<AccountRow> = {}): AccountRow => ({
  id, name, type: 'bank', icon: 'Bank', colorToken: 'cat-indigo', sortOrder: 0, status: 'active', balanceNotSet: true, postingsMinor: 0, ...over,
});
const cats = (kind: AddKind) =>
  mapCategoryRows(SEED_CATEGORIES.filter((c) => c.kind === (kind === 'income' ? 'income' : 'expense')).map((c, i) => [c.id, c.name, c.kind, c.budgetType, c.icon, c.color, i]));

function fakeApi(over: Partial<AddData> = {}) {
  const record = jest.fn(async () => ({ ok: true as const, value: { transactionId: 'tx1', accountId: 'a1' } }));
  const remove = jest.fn(async (...ids: string[]) => ({ ok: ids.length >= 0 }));
  const recordTransfer = jest.fn<Promise<{ ok: true; value: { transactionId: string; feeTransactionId: string | null } } | { ok: false; code: string }>, [TransferInput]>(
    async () => ({ ok: true, value: { transactionId: 'tr1', feeTransactionId: null } }),
  );
  const load = jest.fn(async (kind: AddKind): Promise<AddData> => {
    const categories = cats(kind);
    return {
      currency: 'SGD', exponent: 2, locale: 'en-SG', timezoneId: 'Asia/Singapore', categories,
      quick: rankCategories(categories, new Map()),
      accounts: [account('a1', 'DBS'), account('a2', 'Cash')],
      defaultAccountId: 'a1', blockTransfers: false, ...over,
    };
  });
  const api: AddApi = { load, defaultAccountFor: async () => 'a1', record, recordTransfer, remove };
  return { api, record, recordTransfer, remove };
}

async function mountReady(over: Partial<AddData> = {}, onNewAccount?: () => void) {
  const f = fakeApi(over);
  const qc = createQueryClient();
  clients.push(qc);
  const close = jest.fn();
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <AddSheet api={f.api} close={close} onNewAccount={onNewAccount} now={() => Date.UTC(2026, 10, 8, 10)} />
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  await settle();
  return { r, close, ...f };
}

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
    expect(recordTransfer).toHaveBeenCalledWith({ amountMinor: 20000, fromAccountId: 'a1', toAccountId: 'a2' });
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
    const { r, recordTransfer } = await mountReady({ accounts: [account('a1', 'DBS')] }, onNew);
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
