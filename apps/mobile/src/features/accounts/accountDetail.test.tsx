import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { groupByDay, type AccountRow, type ActivityRow, type CardDetails, type CardDetailsRead } from '@wmbugo/core';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { AccountDetailScreen } from './AccountDetailScreen';
import type { AccountDetailApi, AccountDetailData } from './accountDetailApi';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0 } }));

const live: ReactTestRenderer[] = [];
const clients: ReturnType<typeof createQueryClient>[] = [];
afterEach(async () => {
  await act(async () => new Promise((res) => setTimeout(res, 0)));
  for (const r of live.splice(0)) act(() => r.unmount());
  for (const c of clients.splice(0)) c.clear();
  jest.restoreAllMocks();
});
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
});

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => new Promise((res) => setTimeout(res, 0)));
};
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
const host = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id);
const type = (r: ReactTestRenderer, value: string) =>
  act(() => r.root.findAll((n) => n.props.testID === 'account-panel-input' && typeof n.props.onChangeText === 'function')[0]!.props.onChangeText(value));
const press = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress();

const account = (over: Partial<AccountRow> = {}): AccountRow => ({
  id: 'h', name: 'HDFC', type: 'bank', icon: 'Bank', colorToken: 'cat-indigo', sortOrder: 0, status: 'active', balanceNotSet: false, postingsMinor: 3120000, ...over,
});
const row = (id: string, kind: ActivityRow['kind'], amountMinor: number, localDate: string, over: Partial<ActivityRow> = {}): ActivityRow => ({
  id, kind, amountMinor, localDate, merchant: null, categoryName: 'Food & Drinks', categoryIcon: 'ForkKnife', categoryColor: 'cat-rose', accountName: null, ...over,
});
const data = (rows: ActivityRow[], signed: Record<string, number> = {}, over: Partial<AccountDetailData> = {}): AccountDetailData => ({
  currency: 'INR', exponent: 2, locale: 'en-IN', today: '2026-11-08', account: account(), days: groupByDay(rows), signed, hasMore: false, card: null, starting: { minor: 3000000, localDate: '2026-11-01' }, ...over,
});

async function mountDetail(d: AccountDetailData | 'missing', props: Partial<Parameters<typeof AccountDetailScreen>[0]> = {}) {
  const load = jest.fn<Promise<AccountDetailData | 'missing'>, [string, number?]>(async () => d);
  const setStartingBalance = jest.fn<Promise<{ ok: boolean; code?: string }>, [string, number]>(async () => ({ ok: true }));
  const changeTrackingDate = jest.fn<Promise<{ ok: boolean; code?: string }>, [string, string]>(async () => ({ ok: true }));
  const adjustBalance = jest.fn<Promise<{ ok: boolean; code?: string; transactionId?: string }>, [{ accountId: string; actualMinor: number; reason: string; note?: string }]>(async () => ({ ok: true, transactionId: 'adj1' }));
  const remove = jest.fn<Promise<{ ok: boolean }>, [string]>(async () => ({ ok: true }));
  const updateCardDetails = jest.fn<Promise<{ ok: boolean; code?: string }>, [string, CardDetails]>(async () => ({ ok: true }));
  const api: AccountDetailApi = { load, setStartingBalance, changeTrackingDate, adjustBalance, updateCardDetails, remove: remove as AccountDetailApi['remove'] };
  const qc = createQueryClient();
  clients.push(qc);
  const onBack = jest.fn();
  const onMoveMoney = jest.fn();
  const onAddExpense = jest.fn();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <AccountDetailScreen accountId="h" onBack={onBack} onMoveMoney={onMoveMoney} onAddExpense={onAddExpense} api={api} {...props} />
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  await settle();
  return { r, load, onBack, onMoveMoney, onAddExpense, setStartingBalance, changeTrackingDate, adjustBalance, remove, updateCardDetails };
}

const typeIn = (r: ReactTestRenderer, id: string, value: string) =>
  act(() => r.root.findAll((n) => n.props.testID === id && typeof n.props.onChangeText === 'function')[0]!.props.onChangeText(value));
const r2 = (r: ReactTestRenderer) => String(host(r, 'account-panel-input')[0]!.props.value);

describe('AccountDetailScreen', () => {
  const rows = [
    row('t', 'transfer', 20000, '2026-11-07', { categoryName: null, categoryIcon: null, categoryColor: null, accountName: 'Cash' }),
    row('e', 'expense', 45000, '2026-11-06', { merchant: 'Swiggy' }),
    row('i', 'income', 500000, '2026-11-05', { categoryName: 'Salary', categoryIcon: 'Briefcase', categoryColor: 'cat-emerald' }),
  ];

  it('shows the name, type and balance in the header, the Move money action, and the timeline newest first', async () => {
    const { r } = await mountDetail(data(rows, { t: -20000, e: -45000, i: 500000 }));
    const t = texts(r);
    expect(t).toEqual(expect.arrayContaining(['HDFC', 'Bank account', '₹31,200.00', 'Move money']));
    expect(host(r, 'account-detail-header')[0]!.props.accessibilityLabel).toBe('HDFC, Bank account, 31,200 rupees');
    const order = host(r, 'account-timeline')[0] && r.root.findAll((n) => typeof n.type === 'string' && /^activity-row-/.test(String(n.props.testID))).map((n) => n.props.testID);
    expect(order).toEqual(['activity-row-t', 'activity-row-e', 'activity-row-i']);
  });

  it('a transfer reads "To Cash" with the outgoing leg and "From HDFC" on the other side, unsigned', async () => {
    const out = await mountDetail(data([rows[0]!], { t: -20000 }));
    expect(texts(out.r)).toEqual(expect.arrayContaining(['To Cash', 'Transfer', '₹200.00']));
    expect(texts(out.r).join(' ')).not.toMatch(/[-−–]\s?₹/);
    const into = await mountDetail(data([{ ...rows[0]!, accountName: 'HDFC' }], { t: 20000 }, { account: account({ id: 'c', name: 'Cash', type: 'cash' }) }));
    expect(texts(into.r)).toContain('From HDFC');
  });

  it('the last row is the starting balance with its date and no income styling', async () => {
    const { r } = await mountDetail(data(rows, { t: -20000, e: -45000, i: 500000 }));
    const start = host(r, 'starting-balance')[0]!;
    const t = start.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
    expect(t).toEqual(['Starting balance', '₹30,000.00', '· 1 Nov', 'To correct it, use Adjust balance']);
    expect(t.join('')).not.toContain('+');
  });

  it('no starting balance row when the balance was never set; the header reads Balance not set', async () => {
    const { r } = await mountDetail(data([], {}, { starting: null, account: account({ balanceNotSet: true, postingsMinor: 0 }) }));
    expect(host(r, 'starting-balance')).toHaveLength(0);
    expect(texts(r)).toContain('Balance not set');
    expect(texts(r).join('|')).not.toContain('₹0.00');
  });

  it('flags an entry dated before tracking started, in the subtitle and for TalkBack', async () => {
    const before = row('b', 'expense', 30000, '2026-11-05', { beforeTracking: true, categoryName: 'Food & Drinks' });
    const { r } = await mountDetail(data([before], { b: -30000 }));
    expect(texts(r)).toContain('Food & Drinks · Before tracking started');
    expect(host(r, 'activity-row-b')[0]!.props.accessibilityLabel).toContain('before tracking started');
  });

  it('an empty account shows one sentence and Add an expense; the starting balance still shows', async () => {
    const f = await mountDetail(data([]));
    expect(texts(f.r)).toContain('Nothing recorded on this account yet');
    act(() => press(f.r, 'account-add-expense'));
    expect(f.onAddExpense).toHaveBeenCalled();
    expect(host(f.r, 'starting-balance')).toHaveLength(1);
  });

  it('Move money opens the transfer from this account; a card has no Move money', async () => {
    const a = await mountDetail(data(rows, {}));
    act(() => press(a.r, 'account-move-money'));
    expect(a.onMoveMoney).toHaveBeenCalled();
    const card = await mountDetail(data([], {}, { account: account({ type: 'card', icon: 'CreditCard', postingsMinor: -410000, name: 'HDFC Card' }) }));
    expect(host(card.r, 'account-move-money')).toHaveLength(0);
    expect(texts(card.r)).toEqual(expect.arrayContaining(['You owe', '₹4,100.00']));
  });

  it('asks for a bigger page on Show earlier entries', async () => {
    const f = await mountDetail(data(rows, {}, { hasMore: true }));
    expect(f.load).toHaveBeenLastCalledWith('h', 100);
    expect(host(f.r, 'starting-balance')).toHaveLength(0);
    await act(async () => press(f.r, 'account-show-earlier'));
    await settle();
    expect(f.load).toHaveBeenLastCalledWith('h', 200);
  });

  it('a missing account says so and goes back', async () => {
    const f = await mountDetail('missing');
    expect(texts(f.r)).toContain('This account is not here any more.');
    act(() => press(f.r, 'account-detail-back'));
    expect(f.onBack).toHaveBeenCalled();
  });

  describe('Set balance and Tracking since (Story 2.4)', () => {
    const notSet = (over: Partial<AccountRow> = {}) => account({ balanceNotSet: true, postingsMinor: 0, type: 'cash', icon: 'Money', name: 'Cash', ...over });

    it('a not-set account offers Set balance, not a starting row; a set account does not offer it', async () => {
      const a = await mountDetail(data([], {}, { starting: null, account: notSet() }));
      expect(host(a.r, 'account-set-balance')).toHaveLength(1);
      expect(host(a.r, 'tracking-since')).toHaveLength(0);
      const b = await mountDetail(data(rows, {}));
      expect(host(b.r, 'account-set-balance')).toHaveLength(0);
      expect(host(b.r, 'tracking-since')).toHaveLength(1);
      expect(texts(b.r)).toContain('Tracking since 1 Nov');
    });

    it("asks \"What's in it today?\", saves the exact minor units, closes and refreshes", async () => {
      const f = await mountDetail(data([], {}, { starting: null, account: notSet() }));
      act(() => press(f.r, 'account-set-balance'));
      expect(texts(f.r)).toContain("What's in it today?");
      type(f.r, '1550');
      await act(async () => press(f.r, 'account-panel-save'));
      await settle();
      expect(f.setStartingBalance).toHaveBeenCalledWith('h', 155000);
      expect(host(f.r, 'account-panel')).toHaveLength(0);
      expect(f.load.mock.calls.length).toBeGreaterThan(1);
    });

    it('a card asks how much you owe, labelled Set amount owed', async () => {
      const f = await mountDetail(data([], {}, { starting: null, account: notSet({ type: 'card', icon: 'CreditCard', name: 'Visa' }) }));
      expect(texts(f.r)).toContain('Set amount owed');
      act(() => press(f.r, 'account-set-balance'));
      expect(texts(f.r)).toContain('How much do you owe today?');
      type(f.r, '4100');
      await act(async () => press(f.r, 'account-panel-save'));
      expect(f.setStartingBalance).toHaveBeenCalledWith('h', 410000);
    });

    it('an empty amount shows "Error: amount required", keeps the panel and writes nothing; zero is saved', async () => {
      const f = await mountDetail(data([], {}, { starting: null, account: notSet() }));
      act(() => press(f.r, 'account-set-balance'));
      await act(async () => press(f.r, 'account-panel-save'));
      expect(texts(f.r)).toContain('Error: amount required');
      expect(host(f.r, 'account-panel-error')[0]!.props.accessibilityRole).toBe('alert');
      expect(f.setStartingBalance).not.toHaveBeenCalled();
      type(f.r, 'abc');
      await act(async () => press(f.r, 'account-panel-save'));
      expect(texts(f.r)).toContain('Enter a number, like 3200 or 3200.50.');
      type(f.r, '0');
      await act(async () => press(f.r, 'account-panel-save'));
      expect(f.setStartingBalance).toHaveBeenCalledWith('h', 0);
    });

    it('Tracking since: Change opens the date, saves it, and a future date shows the calm error and keeps the input', async () => {
      const f = await mountDetail(data(rows, {}));
      act(() => press(f.r, 'account-change-date'));
      expect(r2(f.r)).toBe('2026-11-01');
      f.changeTrackingDate.mockResolvedValueOnce({ ok: false, code: 'DATE_IN_FUTURE' });
      type(f.r, '2026-12-01');
      await act(async () => press(f.r, 'account-panel-save'));
      expect(texts(f.r)).toContain('Error: choose today or an earlier date');
      expect(r2(f.r)).toBe('2026-12-01');
      type(f.r, '2026-10-30');
      await act(async () => press(f.r, 'account-panel-save'));
      await settle();
      expect(f.changeTrackingDate).toHaveBeenLastCalledWith('h', '2026-10-30');
      expect(host(f.r, 'account-panel')).toHaveLength(0);
    });
  });

  describe('Adjust balance (Story 2.5)', () => {
    const open = async (over: Partial<AccountDetailData> = {}) => {
      const f = await mountDetail(data(rows, {}, over));
      act(() => press(f.r, 'account-adjust'));
      return f;
    };

    it('is offered when a balance is set and replaced by Set balance when not', async () => {
      const a = await mountDetail(data(rows, {}));
      expect(host(a.r, 'account-adjust')).toHaveLength(1);
      const b = await mountDetail(data([], {}, { starting: null, account: account({ balanceNotSet: true, postingsMinor: 0 }) }));
      expect(host(b.r, 'account-adjust')).toHaveLength(0);
      expect(host(b.r, 'account-set-balance')).toHaveLength(1);
    });

    it('previews the difference without a minus sign, then saves the actual balance with the reason and offers Undo', async () => {
      const f = await open();
      expect(texts(f.r)).toContain('Actual balance today');
      typeIn(f.r, 'adjust-input', '32400');
      const preview = host(f.r, 'adjust-preview')[0]!.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
      expect(preview).toEqual(['Adjust up by', '₹1,200.00']);
      act(() => press(f.r, 'adjust-reason-rough'));
      await act(async () => press(f.r, 'adjust-save'));
      await settle();
      expect(f.adjustBalance).toHaveBeenCalledWith({ accountId: 'h', actualMinor: 3240000, reason: 'rough', note: '' });
      expect(host(f.r, 'adjust-panel')).toHaveLength(0);
      expect(texts(f.r)).toContain('Balance adjusted');
      await act(async () => press(f.r, 'toast-undo'));
      expect(f.remove).toHaveBeenCalledWith('adj1');
    });

    it('lower reads "Adjust down by"; the four reasons are offered; Other asks for a note', async () => {
      const f = await open();
      typeIn(f.r, 'adjust-input', '30800');
      expect(texts(f.r)).toEqual(expect.arrayContaining(['Adjust down by', '₹400.00', 'Starting balance was rough', 'Missed some entries', 'Bank charges or interest', 'Other']));
      expect(host(f.r, 'adjust-note')).toHaveLength(0);
      act(() => press(f.r, 'adjust-reason-other'));
      typeIn(f.r, 'adjust-note', 'Lent to Sam');
      await act(async () => press(f.r, 'adjust-save'));
      expect(f.adjustBalance).toHaveBeenCalledWith({ accountId: 'h', actualMinor: 3080000, reason: 'other', note: 'Lent to Sam' });
    });

    it('a missing reason shows "Error: reason required" and writes nothing', async () => {
      const f = await open();
      typeIn(f.r, 'adjust-input', '32400');
      await act(async () => press(f.r, 'adjust-save'));
      expect(texts(f.r)).toContain('Error: reason required');
      expect(f.adjustBalance).not.toHaveBeenCalled();
    });

    it('the same amount says it already matches and writes nothing; an empty amount asks for one', async () => {
      const f = await open();
      await act(async () => press(f.r, 'adjust-save'));
      expect(texts(f.r)).toContain('Error: amount required');
      typeIn(f.r, 'adjust-input', '31200');
      expect(texts(f.r)).toContain('Already matches. Nothing to adjust.');
      act(() => press(f.r, 'adjust-reason-rough'));
      await act(async () => press(f.r, 'adjust-save'));
      expect(f.adjustBalance).not.toHaveBeenCalled();
    });

    it('a card asks for the amount you owe: 4,350 against 4,100 reads "You owe ₹250.00 more"', async () => {
      const f = await open({ account: account({ type: 'card', icon: 'CreditCard', name: 'HDFC Card', postingsMinor: -410000 }) });
      expect(texts(f.r)).toContain('Amount you owe today');
      typeIn(f.r, 'adjust-input', '4350');
      expect(texts(f.r)).toEqual(expect.arrayContaining(['You owe ', '₹250.00', ' more']));
      act(() => press(f.r, 'adjust-reason-charges'));
      await act(async () => press(f.r, 'adjust-save'));
      expect(f.adjustBalance).toHaveBeenCalledWith({ accountId: 'h', actualMinor: 435000, reason: 'charges', note: '' });
    });

    it('an adjustment row reads Balance adjustment, Adjusted up, unsigned, and TalkBack hears the direction', async () => {
      const adj = row('a1', 'adjustment', 120000, '2026-11-07', { categoryName: null, categoryIcon: null, categoryColor: null, signedMinor: 120000 });
      const down = row('a2', 'adjustment', 40000, '2026-11-06', { categoryName: null, categoryIcon: null, categoryColor: null, signedMinor: -40000 });
      const f = await mountDetail(data([adj, down], { a1: 120000, a2: -40000 }));
      expect(texts(f.r)).toEqual(expect.arrayContaining(['Balance adjustment', 'Adjusted up', 'Adjusted down', '₹1,200.00', '₹400.00']));
      expect(texts(f.r).join(' ')).not.toMatch(/[-−–+]\s?₹/);
      expect(host(f.r, 'activity-row-a1')[0]!.props.accessibilityLabel).toBe('Balance adjustment, up 1,200 rupees, Saturday 7 November');
      expect(host(f.r, 'activity-row-a2')[0]!.props.accessibilityLabel).toContain('Balance adjustment, down 400 rupees');
    });
  });

  describe('Card details (Story 2.6)', () => {
    const cardAccount = account({ type: 'card', icon: 'CreditCard', name: 'HDFC Card', postingsMinor: -1245000 });
    const card = (over: Partial<CardDetailsRead> = {}): CardDetailsRead => ({ statementDueMinor: 820000, dueDate: '2026-11-15', limitMinor: 10000000, paidSinceMinor: 0, ...over });
    const mountCard = (c: CardDetailsRead | null, over: Partial<AccountDetailData> = {}) => mountDetail(data([], {}, { account: cardAccount, card: c, ...over }));
    const line = (r: ReactTestRenderer, id: string) =>
      host(r, id)[0]!.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join('')).join('');

    it('the header reads You owe with the caption From your entries in wmbugo, and offers Card details', async () => {
      const f = await mountCard(null);
      expect(texts(f.r)).toEqual(expect.arrayContaining(['You owe', '₹12,450.00', 'From your entries in wmbugo']));
      expect(host(f.r, 'account-card-details')).toHaveLength(1);
      expect(host(f.r, 'card-lines')).toHaveLength(0);
    });

    it('shows Statement due with its date and the Limit as separate lines', async () => {
      const f = await mountCard(card());
      expect(line(f.r, 'statement-line')).toBe('Statement due ₹8,200.00 · by 15 Nov');
      expect(line(f.r, 'limit-line')).toBe('Limit ₹1,00,000.00');
      expect(host(f.r, 'statement-line')[0]!.props.accessibilityLabel).toBe('Statement due 8,200 rupees · by 15 Nov');
    });

    it('reads Statement paid once payments reach the statement, and keeps showing it', async () => {
      const f = await mountCard(card({ paidSinceMinor: 820000 }));
      expect(line(f.r, 'statement-line')).toBe('Statement paid · ₹8,200.00');
    });

    it('past the due date and unpaid it reads "was due" with a warning icon in primary text, not red', async () => {
      const f = await mountCard(card(), { today: '2026-11-20' });
      expect(line(f.r, 'statement-line')).toBe('Statement due ₹8,200.00 · was due 15 Nov');
      const texts2 = host(f.r, 'statement-line')[0]!.findAll((n) => n.type === Text);
      expect(texts2.some((n) => JSON.stringify(n.props.style).includes('semantic-expense'))).toBe(false);
    });

    it('the panel says wmbugo is not connected to the bank, prefills what is stored and saves exact minor units', async () => {
      const f = await mountCard(card());
      act(() => press(f.r, 'account-card-details'));
      expect(texts(f.r)).toContain("You enter these from your statement. wmbugo isn't connected to your bank.");
      expect(host(f.r, 'card-statement')[0]!.props.value).toBe('8200');
      expect(host(f.r, 'card-date')[0]!.props.value).toBe('2026-11-15');
      typeIn(f.r, 'card-limit', '150000');
      await act(async () => press(f.r, 'card-save'));
      await settle();
      expect(f.updateCardDetails).toHaveBeenCalledWith('h', { statementDueMinor: 820000, dueDate: '2026-11-15', limitMinor: 15000000 });
      expect(host(f.r, 'card-panel')).toHaveLength(0);
    });

    it('clearing a field removes it; zero is refused with a calm error and nothing is written', async () => {
      const f = await mountCard(card());
      act(() => press(f.r, 'account-card-details'));
      typeIn(f.r, 'card-limit', '0');
      await act(async () => press(f.r, 'card-save'));
      expect(texts(f.r)).toContain('Error: enter a limit or leave it empty');
      expect(f.updateCardDetails).not.toHaveBeenCalled();
      typeIn(f.r, 'card-limit', '');
      typeIn(f.r, 'card-statement', '0');
      await act(async () => press(f.r, 'card-save'));
      expect(texts(f.r)).toContain('Error: enter an amount or leave it empty');
      typeIn(f.r, 'card-statement', '');
      typeIn(f.r, 'card-date', '');
      await act(async () => press(f.r, 'card-save'));
      expect(f.updateCardDetails).toHaveBeenCalledWith('h', { statementDueMinor: null, dueDate: null, limitMinor: null });
    });

    it('a bad date shows the calm error and keeps the input', async () => {
      const f = await mountCard(card());
      act(() => press(f.r, 'account-card-details'));
      typeIn(f.r, 'card-date', 'soon');
      await act(async () => press(f.r, 'card-save'));
      expect(texts(f.r)).toContain('Error: check the date');
      expect(host(f.r, 'card-date')[0]!.props.value).toBe('soon');
    });
  });
});
