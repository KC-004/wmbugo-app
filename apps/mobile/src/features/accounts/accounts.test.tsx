import { AccessibilityInfo, Text, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import type { AccountRow, NewAccount } from '@wmbugo/core';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { AccountForm } from './AccountForm';
import { AccountsScreen } from './AccountsScreen';
import type { AccountsApi } from './accountsApi';

// The real api reaches the encrypted database through startApp; these tests inject a fake api instead.
jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn() }));

const live: ReactTestRenderer[] = [];
const clients: ReturnType<typeof createQueryClient>[] = [];
afterEach(() => {
  for (const r of live.splice(0)) act(() => r.unmount());
  for (const c of clients.splice(0)) c.clear();
  jest.restoreAllMocks();
});
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
  jest.spyOn(AccessibilityInfo, 'getRecommendedTimeoutMillis').mockImplementation(async (ms: number) => ms);
});

const fire = (r: ReactTestRenderer, testID: string, handler = 'onPress', ...args: unknown[]) =>
  r.root.findAll((n) => n.props.testID === testID && typeof n.props[handler] === 'function')[0]!.props[handler](...args);
/** Lets queued promises and TanStack Query fetches settle inside act. */
const settle = async () => {
  for (let i = 0; i < 3; i++) await act(async () => new Promise((res) => setTimeout(res, 0)));
};
const has = (r: ReactTestRenderer, testID: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === testID).length > 0;
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));

describe('AccountForm', () => {
  // React Native's Jest setup gives every TextInput a shared jest.fn() focus().
  const focusMock = (TextInput as unknown as { prototype: { focus: jest.Mock } }).prototype.focus;
  function mountForm(over: Partial<Parameters<typeof AccountForm>[0]> = {}) {
    const onSubmit = jest.fn<void, [NewAccount]>();
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <ThemeProvider>
          <AccountForm exponent={2} submitLabel="Save account" onSubmit={onSubmit} {...over} />
        </ThemeProvider>,
      );
    });
    live.push(r);
    focusMock.mockClear();
    return { r, onSubmit, focus: focusMock };
  }

  it('offers the five types and the "Rough is fine" hint', () => {
    const { r } = mountForm();
    expect(texts(r)).toEqual(expect.arrayContaining(['Cash', 'Bank account', 'Payment wallet', 'Savings pot', 'Credit card', 'Rough is fine']));
    expect(r.root.findAll((n) => typeof n.type === 'string' && String(n.props.testID).startsWith('account-type-'))).toHaveLength(5);
    expect(r.root.findAll((n) => n.props.testID === 'account-balance' && n.props.accessibilityHint === 'Rough is fine').length).toBeGreaterThan(0);
  });

  it('submits a bank account with a rough balance in exact minor units', () => {
    const { r, onSubmit } = mountForm();
    act(() => fire(r, 'account-name', 'onChangeText', 'DBS'));
    act(() => fire(r, 'account-balance', 'onChangeText', '3200'));
    act(() => fire(r, 'account-submit'));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'DBS', type: 'bank', openingMinor: 320000 });
  });

  it('a card asks for the amount owed', () => {
    const { r, onSubmit } = mountForm();
    act(() => fire(r, 'account-type-card'));
    expect(texts(r)).toContain('Amount owed today');
    act(() => fire(r, 'account-name', 'onChangeText', 'Visa'));
    act(() => fire(r, 'account-balance', 'onChangeText', '450.50'));
    act(() => fire(r, 'account-submit'));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Visa', type: 'card', openingMinor: 45050 });
  });

  it('no balance means "not set"', () => {
    const { r, onSubmit } = mountForm();
    act(() => fire(r, 'account-name', 'onChangeText', 'Wallet'));
    act(() => fire(r, 'account-type-wallet'));
    act(() => fire(r, 'account-submit'));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Wallet', type: 'wallet', openingMinor: null });
  });

  it('an empty name shows "Error: name required", keeps the input, focuses the field and writes nothing', () => {
    const { r, onSubmit, focus } = mountForm();
    act(() => fire(r, 'account-balance', 'onChangeText', '3200'));
    act(() => fire(r, 'account-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(texts(r)).toContain('Error: name required');
    expect(r.root.findAll((n) => n.props.testID === 'account-name-error' && n.props.accessibilityRole === 'alert').length).toBeGreaterThan(0);
    expect(r.root.findAll((n) => n.props.testID === 'account-balance' && n.props.value === '3200').length).toBeGreaterThan(0);
    expect(focus).toHaveBeenCalled();
    act(() => fire(r, 'account-name', 'onChangeText', '  '));
    act(() => fire(r, 'account-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a bad balance shows a calm error and does not submit; decimals beyond the currency are refused, never rounded', () => {
    const { r, onSubmit } = mountForm();
    act(() => fire(r, 'account-name', 'onChangeText', 'DBS'));
    act(() => fire(r, 'account-balance', 'onChangeText', 'abc'));
    act(() => fire(r, 'account-submit'));
    expect(texts(r)).toContain('Enter a number, like 3200 or 3200.50.');
    act(() => fire(r, 'account-balance', 'onChangeText', '12.505'));
    act(() => fire(r, 'account-submit'));
    expect(texts(r)).toContain('That has more decimals than this currency uses.');
    act(() => fire(r, 'account-balance', 'onChangeText', '-5'));
    act(() => fire(r, 'account-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('whole-unit currencies take whole numbers only', () => {
    const { r, onSubmit } = mountForm({ exponent: 0 });
    act(() => fire(r, 'account-name', 'onChangeText', 'BCA'));
    act(() => fire(r, 'account-balance', 'onChangeText', '1500.5'));
    act(() => fire(r, 'account-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    act(() => fire(r, 'account-balance', 'onChangeText', '1500'));
    act(() => fire(r, 'account-submit'));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'BCA', type: 'bank', openingMinor: 1500 });
  });

  it('offers Skip when asked, and shows a save error without losing the input', () => {
    const onSkip = jest.fn();
    const { r } = mountForm({ onSkip, saveError: 'Could not save the account.' });
    act(() => fire(r, 'account-skip'));
    expect(onSkip).toHaveBeenCalled();
    expect(texts(r)).toContain('Could not save the account. Nothing was saved');
  });
});

describe('AccountsScreen', () => {
  const row = (over: Partial<AccountRow> & { id: string; name: string }): AccountRow => ({
    type: 'bank',
    icon: 'Bank',
    colorToken: 'cat-indigo',
    sortOrder: 0,
    status: 'active',
    balanceNotSet: false,
    postingsMinor: 0,
    ...over,
  });

  function fakeApi(initial: AccountRow[]) {
    const state = { rows: [...initial], netWorth: false };
    const api: AccountsApi & { calls: string[] } = {
      calls: [],
      profile: async () => ({ currency: 'SGD', exponent: 2, locale: 'en-SG' }),
      list: async () => state.rows.map((r) => ({ ...r })).sort((a, b) => a.sortOrder - b.sortOrder),
      add: async (a) => {
        api.calls.push(`add:${a.name}`);
        state.rows.push(row({ id: `n${state.rows.length}`, name: a.name, type: a.type, sortOrder: state.rows.length, balanceNotSet: a.openingMinor === null, postingsMinor: a.openingMinor ?? 0 }));
        return { ok: true };
      },
      rename: async (id, name) => {
        api.calls.push(`rename:${id}:${name}`);
        const r = state.rows.find((x) => x.id === id);
        if (r) state.rows[state.rows.indexOf(r)] = { ...r, name };
        return { ok: true };
      },
      move: async (id, d) => {
        api.calls.push(`move:${id}:${d}`);
        const me = state.rows.find((r) => r.id === id)!;
        const active = state.rows.filter((r) => r.status === 'active' && (r.type === 'card') === (me.type === 'card')).sort((a, b) => a.sortOrder - b.sortOrder);
        const i = active.findIndex((r) => r.id === id);
        const j = d === 'up' ? i - 1 : i + 1;
        const a = active[i]!;
        const b = active[j]!;
        const ai = state.rows.indexOf(a);
        const bi = state.rows.indexOf(b);
        state.rows[ai] = { ...a, sortOrder: b.sortOrder };
        state.rows[bi] = { ...b, sortOrder: a.sortOrder };
        return { ok: true };
      },
      deleteAccount: async (id) => {
        api.calls.push(`delete:${id}`);
        state.rows = state.rows.filter((x) => x.id !== id);
        return { ok: true };
      },
      changeType: async (id, type) => {
        api.calls.push(`type:${id}:${type}`);
        if (type === 'card' && state.rows.find((x) => x.id === id)?.type !== 'card' && id === 'blocked') return { ok: false, code: 'HAS_ENTRIES' };
        const r = state.rows.find((x) => x.id === id)!;
        state.rows[state.rows.indexOf(r)] = { ...r, type };
        return { ok: true };
      },
      setInclusion: async (id, include) => {
        api.calls.push(`include:${id}:${include}`);
        const r = state.rows.find((x) => x.id === id)!;
        state.rows[state.rows.indexOf(r)] = { ...r, includeInOverview: include };
        return { ok: true };
      },
      showNetWorth: async () => state.netWorth,
      setShowNetWorth: async (on) => {
        api.calls.push(`networth:${on}`);
        state.netWorth = on;
        return { ok: true };
      },
      restore: async (id) => {
        api.calls.push(`restore:${id}`);
        const r = state.rows.find((x) => x.id === id)!;
        state.rows[state.rows.indexOf(r)] = { ...r, status: 'active' };
        return { ok: true };
      },
    };
    return api;
  }

  async function mountScreen(api: AccountsApi, onOpen?: (id: string) => void, onPayBill?: (id: string) => void) {
    const qc = createQueryClient();
    clients.push(qc);
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <QueryClientProvider client={qc}>
          <ThemeProvider>
            <ToastHost>
              <AccountsScreen api={api} onOpen={onOpen} onPayBill={onPayBill} />
            </ToastHost>
          </ThemeProvider>
        </QueryClientProvider>,
      );
    });
    live.push(r);
    await settle();
    return r;
  }
  const press = async (r: ReactTestRenderer, id: string) => {
    await act(async () => fire(r, id));
    await settle();
  };

  const three = () => [
    row({ id: 'a', name: 'DBS', sortOrder: 0, postingsMinor: 320000 }),
    row({ id: 'b', name: 'Cash', type: 'cash', icon: 'Money', colorToken: 'cat-lime', sortOrder: 1, balanceNotSet: true }),
    row({ id: 'c', name: 'Visa', type: 'card', icon: 'CreditCard', colorToken: 'cat-fuchsia', sortOrder: 2, postingsMinor: -45000 }),
  ];

  it('shows each active account with type and balance: a ledger balance, "Balance not set" (never zero), or card dues without a minus', async () => {
    const r = await mountScreen(fakeApi(three()));
    const balance = (id: string) => JSON.stringify(r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === `balance-${id}`)[0]!.props.children ?? '') + texts(r).join('|');
    expect(texts(r)).toEqual(expect.arrayContaining(['DBS', 'Bank account', 'Cash', 'Visa', 'Credit card', 'Balance not set', 'S$3,200.00', 'You owe', 'S$450.00']));
    expect(texts(r).join('|')).not.toMatch(/[-−]/);
    expect(balance('b')).not.toMatch(/S\$0\.00/);
    expect(texts(r).filter((t) => t === 'Balance not set')).toHaveLength(1);
  });

  it('reads each row to TalkBack with name, type and balance, and offers the custom actions', async () => {
    const r = await mountScreen(fakeApi(three()));
    const mid = r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'account-row-b')[0]!;
    expect(mid.props.accessibilityLabel).toBe('Cash, Cash, Balance not set');
    expect(mid.props.accessibilityActions.map((a: { label: string }) => a.label)).toEqual(['Move up', 'Rename']);
    const first = r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'account-row-a')[0]!;
    expect(first.props.accessibilityLabel).toBe('DBS, Bank account, 3,200 Singapore dollars');
    expect(first.props.accessibilityActions.map((a: { label: string }) => a.label)).toEqual(['Move down', 'Rename']);
    const card = r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'account-row-c')[0]!;
    expect(card.props.accessibilityLabel).toBe('Visa, Credit card, You owe 450 Singapore dollars');
  });

  it('Move up / Move down work from the buttons and from TalkBack custom actions; edges have no button', async () => {
    const api = fakeApi(three());
    const r = await mountScreen(api);
    expect(has(r, 'move-up-a')).toBe(false);
    expect(has(r, 'move-down-c')).toBe(false);
    await press(r, 'move-up-b');
    expect(api.calls).toContain('move:b:up');
    const row = r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'account-row-a')[0]!;
    await act(async () => row.props.onAccessibilityAction({ nativeEvent: { actionName: 'moveUp' } }));
    await settle();
    expect(api.calls).toContain('move:a:up');
    const order = r.root.findAll((n) => typeof n.type === 'string' && /^account-row-/.test(String(n.props.testID))).map((n) => n.props.testID);
    expect(order).toEqual(['account-row-a', 'account-row-b', 'account-row-c']);
  });

  it('adds an account through the same form', async () => {
    const api = fakeApi(three());
    const r = await mountScreen(api);
    await press(r, 'accounts-add');
    expect(has(r, 'account-form')).toBe(true);
    act(() => fire(r, 'account-name', 'onChangeText', 'Savings'));
    act(() => fire(r, 'account-type-savings_pot'));
    await press(r, 'account-submit');
    expect(api.calls).toContain('add:Savings');
    expect(has(r, 'account-form')).toBe(false);
    expect(texts(r)).toContain('Savings');
    expect(texts(r).filter((t) => t === 'Balance not set').length).toBe(1);
    expect(texts(r)).toContain('Nothing moved in yet');
  });

  it('renames; an empty name shows the inline error and writes nothing', async () => {
    const api = fakeApi(three());
    const r = await mountScreen(api);
    await press(r, 'rename-a');
    act(() => fire(r, 'rename-input', 'onChangeText', ''));
    await press(r, 'rename-save');
    expect(texts(r)).toContain('Error: name required');
    expect(api.calls.some((c) => c.startsWith('rename'))).toBe(false);
    act(() => fire(r, 'rename-input', 'onChangeText', 'DBS Savings'));
    await press(r, 'rename-save');
    expect(api.calls).toContain('rename:a:DBS Savings');
    expect(texts(r)).toContain('DBS Savings');
  });

  it('an overpaid card reads In credit in Money you owe and adds nothing to the owe total', async () => {
    const r = await mountScreen(fakeApi([row({ id: 'h', name: 'HDFC', postingsMinor: 100000 }), row({ id: 'k', name: 'Visa', type: 'card', sortOrder: 1, postingsMinor: 50000 })]));
    expect(texts(r)).toEqual(expect.arrayContaining(['In credit', 'S$500.00']));
    expect(total(r, 'group-owe-header-total')).toBe('S$0.00');
    expect(total(r, 'group-have-header-total')).toBe('S$1,000.00');
  });

  it('group headers read their total and what is not set or left out for TalkBack', async () => {
    const r = await mountScreen(fakeApi([...three(), row({ id: 'x', name: 'Old', sortOrder: 3, postingsMinor: 5000, includeInOverview: false })]));
    const header = r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'group-have-header')[0]!;
    expect(header.props.accessibilityRole).toBe('header');
    expect(header.props.accessibilityLabel).toBe('Money you have, 3,200 Singapore dollars, +1 account not set, Excludes 1 account');
  });

    it('archived accounts sit under a collapsed "Archived (n)" row; opened, each shows its final balance, Open and Restore', async () => {
    const onOpen = jest.fn();
    const api = fakeApi([...three(), row({ id: 'z', name: 'Old SBI', status: 'archived', sortOrder: 9, postingsMinor: 120000 })]);
    const r = await mountScreen(api, onOpen);
    expect(texts(r)).toContain('Archived (1)');
    expect(has(r, 'archived-row-z')).toBe(false);
    await press(r, 'archived-toggle');
    expect(has(r, 'archived-row-z')).toBe(true);
    expect(texts(r)).toEqual(expect.arrayContaining(['Old SBI', 'S$1,200.00']));
    await press(r, 'archived-open-z');
    expect(onOpen).toHaveBeenCalledWith('z');
    await press(r, 'archived-restore-z');
    expect(api.calls).toContain('restore:z');
    expect(has(r, 'account-row-z')).toBe(true);
    expect(has(r, 'archived-section')).toBe(false);
  });

  it('Delete account is offered only for an account that never held anything, behind "Delete X? This can\'t be undone."', async () => {
    const api = fakeApi([row({ id: 'e', name: 'Mistake', type: 'cash', sortOrder: 0, balanceNotSet: true, postingCount: 0 }), row({ id: 'u', name: 'Used', sortOrder: 1, postingsMinor: 100, postingCount: 2 })]);
    const r = await mountScreen(api);
    await press(r, 'rename-u');
    expect(has(r, 'delete-u')).toBe(false);
    expect(texts(r)).toContain("Accounts with entries can't be deleted. Archive keeps their history.");
    await press(r, 'rename-cancel');
    await press(r, 'rename-e');
    await press(r, 'delete-e');
    expect(texts(r)).toContain("Delete Mistake? This can't be undone.");
    expect(api.calls.some((c) => c.startsWith('delete'))).toBe(false);
    await press(r, 'delete-no-e');
    expect(has(r, 'delete-e')).toBe(true);
    await press(r, 'delete-e');
    await press(r, 'delete-yes-e');
    expect(api.calls).toContain('delete:e');
    expect(has(r, 'account-row-e')).toBe(false);
  });

  // The text of a group total: its Text children joined (the amount is its own Text).
  const total = (r: ReactTestRenderer, id: string) =>
    r.root
      .findAll((n) => typeof n.type === 'string' && n.props.testID === id)[0]!
      .findAll((n) => n.type === Text)
      .map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''))
      .join(' ');

  it('splits into Money you have and Money you owe, each with its own total, never added together', async () => {
    const r = await mountScreen(
      fakeApi([
        row({ id: 'a', name: 'Cash', type: 'cash', sortOrder: 0, postingsMinor: 230000 }),
        row({ id: 'b', name: 'HDFC', sortOrder: 1, postingsMinor: 3120000 }),
        row({ id: 'c', name: 'SBI', sortOrder: 2, postingsMinor: 1880000 }),
        row({ id: 'd', name: 'HDFC Card', type: 'card', sortOrder: 3, postingsMinor: -410000 }),
      ]),
    );
    expect(texts(r)).toEqual(expect.arrayContaining(['Money you have', 'Money you owe', 'You owe', 'S$4,100.00']));
    expect(total(r, 'group-have-header-total')).toBe('S$52,300.00');
    expect(total(r, 'group-owe-header-total')).toBe('S$4,100.00');
    const order = r.root.findAll((n) => typeof n.type === 'string' && /^(group-|account-row-)/.test(String(n.props.testID)) && !String(n.props.testID).includes('header')).map((n) => n.props.testID);
    expect(order).toEqual(['group-have', 'account-row-a', 'account-row-b', 'account-row-c', 'group-owe', 'account-row-d']);
    expect(r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'group-have-header')[0]!.props.accessibilityLabel).toBe('Money you have, 52,300 Singapore dollars');
  });

  it('a not-set account adds "+1 account not set" to the total; only not-set accounts read "Not set yet", never zero', async () => {
    const mixed = await mountScreen(fakeApi(three()));
    expect(total(mixed, 'group-have-header-total')).toBe('S$3,200.00 · +1 account not set');
    const only = await mountScreen(fakeApi([row({ id: 'z', name: 'Cash', type: 'cash', balanceNotSet: true })]));
    expect(texts(only)).toContain('Not set yet');
    expect(texts(only).join('|')).not.toMatch(/S\$0\.00/);
  });

  it('a card with no balance reads "Balance not set" and the owe total reads "Not set yet"', async () => {
    const r = await mountScreen(fakeApi([row({ id: 'k', name: 'Visa', type: 'card', balanceNotSet: true })]));
    expect(total(r, 'group-owe-header-total')).toBe('Not set yet');
    expect(texts(r)).toContain('Balance not set');
  });

  it('an account below zero reads "Below zero S$500.00" with no minus sign, and the total takes it as a reduction', async () => {
    const r = await mountScreen(
      fakeApi([row({ id: 'a', name: 'Cash', type: 'cash', sortOrder: 0, postingsMinor: -50000 }), row({ id: 'b', name: 'DBS', sortOrder: 1, postingsMinor: 120000 })]),
    );
    expect(texts(r)).toEqual(expect.arrayContaining(['Below zero', 'S$500.00']));
    expect(total(r, 'group-have-header-total')).toBe('S$700.00');
    expect(texts(r).join('|')).not.toMatch(/[-−]/);
  });

  it('a group total below zero reads "Below zero S$X"', async () => {
    const r = await mountScreen(fakeApi([row({ id: 'a', name: 'Cash', type: 'cash', postingsMinor: -50000 })]));
    expect(total(r, 'group-have-header-total')).toBe('Below zero S$500.00');
  });

  it('Count in my totals: off drops the balance from the total, labels the row and adds "Excludes 1 account"; cards have no toggle', async () => {
    const api = fakeApi([
      row({ id: 'a', name: 'Cash', type: 'cash', sortOrder: 0, postingsMinor: 230000 }),
      row({ id: 'b', name: 'HDFC', sortOrder: 1, postingsMinor: 3120000 }),
      row({ id: 'k', name: 'Visa', type: 'card', sortOrder: 2, postingsMinor: -45000 }),
    ]);
    const r = await mountScreen(api);
    await press(r, 'rename-k');
    expect(has(r, 'include-k')).toBe(false);
    await press(r, 'rename-cancel');
    await press(r, 'rename-a');
    const sw = r.root.findAll((n) => n.props.testID === 'include-a' && typeof n.props.onValueChange === 'function')[0]!;
    expect(sw.props.accessibilityLabel).toBe('Count in my totals');
    expect(sw.props.accessibilityState).toEqual({ checked: true });
    await act(async () => sw.props.onValueChange(false));
    await settle();
    expect(api.calls).toContain('include:a:false');
    await press(r, 'rename-cancel');
    expect(total(r, 'group-have-header-total')).toBe('S$31,200.00');
    expect(texts(r)).toEqual(expect.arrayContaining(['Excludes 1 account', 'Not counted in totals']));
    expect(has(r, 'not-counted-a')).toBe(true);
  });

  it('Show net worth is off by default; on, it shows one separate row from counted accounts, and off removes it', async () => {
    const api = fakeApi([row({ id: 'a', name: 'DBS', postingsMinor: 5230000 }), row({ id: 'k', name: 'Visa', type: 'card', sortOrder: 1, postingsMinor: -410000 })]);
    const r = await mountScreen(api);
    expect(has(r, 'net-worth')).toBe(false);
    await act(async () => r.root.findAll((n) => n.props.testID === 'switch-net-worth' && typeof n.props.onValueChange === 'function')[0]!.props.onValueChange(true));
    await settle();
    expect(api.calls).toContain('networth:true');
    expect(texts(r)).toEqual(expect.arrayContaining(['Net worth', 'S$48,200.00', 'What you have minus what you owe']));
    await act(async () => r.root.findAll((n) => n.props.testID === 'switch-net-worth' && typeof n.props.onValueChange === 'function')[0]!.props.onValueChange(false));
    await settle();
    expect(has(r, 'net-worth')).toBe(false);
  });

  it('net worth says you owe more when the cards outweigh the accounts', async () => {
    const api = fakeApi([row({ id: 'a', name: 'DBS', postingsMinor: 100000 }), row({ id: 'k', name: 'Visa', type: 'card', sortOrder: 1, postingsMinor: -250000 })]);
    await api.setShowNetWorth(true);
    const r = await mountScreen(api);
    expect(texts(r)).toEqual(expect.arrayContaining(['Net worth: you owe ', 'S$1,500.00', ' more than you have']));
  });

  it('tapping a row opens that account; while renaming it does not', async () => {
    const onOpen = jest.fn();
    const r = await mountScreen(fakeApi(three()), onOpen);
    const rowOf = (id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === `account-row-${id}`)[0]!;
    expect(rowOf('a').props.accessibilityRole).toBe('button');
    await act(async () => fire(r, 'account-row-a'));
    expect(onOpen).toHaveBeenCalledWith('a');
    await press(r, 'rename-a');
    expect(r.root.findAll((n) => n.props.testID === 'account-row-a' && typeof n.props.onPress === 'function')).toHaveLength(0);
  });

  it('a card row offers Pay card bill (button and TalkBack action); other accounts do not', async () => {
    const onPayBill = jest.fn();
    const r = await mountScreen(fakeApi(three()), undefined, onPayBill);
    expect(has(r, 'pay-bill-a')).toBe(false);
    await press(r, 'pay-bill-c');
    expect(onPayBill).toHaveBeenCalledWith('c');
    const card = r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'account-row-c')[0]!;
    expect(card.props.accessibilityActions.map((a: { label: string }) => a.label)).toContain('Pay card bill');
  });

  it('the pot form explains what a pot is and says to leave the balance empty for market-valued money', async () => {
    let f!: ReactTestRenderer;
    act(() => {
      f = create(
        <ThemeProvider>
          <AccountForm exponent={2} submitLabel="Save account" onSubmit={jest.fn()} />
        </ThemeProvider>,
      );
    });
    live.push(f);
    expect(has(f, 'pot-hint')).toBe(false);
    act(() => fire(f, 'account-type-savings_pot'));
    expect(texts(f)).toEqual(
      expect.arrayContaining(['For SIPs, RDs, PPF or an emergency fund. Not your everyday bank account, even if the bank calls it a savings account.', 'Leave empty if the value changes with the market']),
    );
  });

  describe('savings pots', () => {
    const pots = () => [
      row({ id: 'h', name: 'HDFC', sortOrder: 0, postingsMinor: 3000000 }),
      row({ id: 'e', name: 'Emergency fund', type: 'savings_pot', icon: 'PiggyBank', colorToken: 'cat-emerald', sortOrder: 1, postingsMinor: 4000000 }),
      row({ id: 's', name: 'SIP – Axis MF', type: 'savings_pot', icon: 'PiggyBank', colorToken: 'cat-emerald', sortOrder: 2, balanceNotSet: true, movedInMinor: 500000 }),
    ];

    it('a pot with a balance counts; one without sits under Saved & invested as "moved in", out of the total and not "not set"', async () => {
      const r = await mountScreen(fakeApi(pots()));
      expect(total(r, 'group-have-header-total')).toBe('S$70,000.00');
      expect(texts(r)).toEqual(expect.arrayContaining(['Saved & invested', 'S$5,000.00', 'moved in']));
      expect(texts(r).join('|')).not.toContain('not set');
      const order = r.root.findAll((n) => typeof n.type === 'string' && (n.props.testID === 'saved-heading' || /^account-row-/.test(String(n.props.testID)))).map((n) => n.props.testID);
      expect(order).toEqual(['account-row-h', 'account-row-e', 'saved-heading', 'account-row-s']);
    });

    it('TalkBack reads the no-balance pot as moved in and not counted in your totals', async () => {
      const r = await mountScreen(fakeApi(pots()));
      const node = r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'account-row-s')[0]!;
      expect(node.props.accessibilityLabel).toBe('SIP – Axis MF, Savings pot, 5,000 Singapore dollars moved in, not counted in your totals');
    });

    it('a pot whose net is zero or below reads "Nothing moved in yet", never a minus', async () => {
      const r = await mountScreen(fakeApi([row({ id: 's', name: 'SIP', type: 'savings_pot', balanceNotSet: true, movedInMinor: -200000 })]));
      expect(texts(r)).toContain('Nothing moved in yet');
      expect(texts(r).join('|')).not.toMatch(/[-−]\s?S\$/);
    });
  });

  describe('changing the account type', () => {
    it('editing shows the five types; choosing one saves it', async () => {
      const api = fakeApi(three());
      const r = await mountScreen(api);
      await press(r, 'rename-a');
      expect(r.root.findAll((n) => typeof n.type === 'string' && /^type-a-/.test(String(n.props.testID)))).toHaveLength(5);
      await press(r, 'type-a-savings_pot');
      expect(api.calls).toContain('type:a:savings_pot');
    });

    it('a blocked change says so calmly', async () => {
      const api = fakeApi([row({ id: 'blocked', name: 'HDFC', sortOrder: 0, postingsMinor: 100 })]);
      const r = await mountScreen(api);
      await press(r, 'rename-blocked');
      await press(r, 'type-blocked-card');
      expect(texts(r)).toContain('This account has entries. Add a new card instead.');
    });
  });

  it('archived accounts are not listed', async () => {
    const r = await mountScreen(fakeApi([...three(), row({ id: 'z', name: 'Old', status: 'archived', sortOrder: 9 })]));
    expect(has(r, 'account-row-z')).toBe(false);
  });

  it('with no accounts shows the empty state with one button', async () => {
    const r = await mountScreen(fakeApi([]));
    expect(has(r, 'empty-state')).toBe(true);
    expect(texts(r)).toContain('No accounts yet. Add the one where most of your money is.');
  });
});
