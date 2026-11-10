import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { groupByDay, type ActivityRow, type SplitRow, type SplitView, type TransactionDetail } from '@wmbugo/core';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { createQueryClient } from '../../shared/queryClient';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { AddSheet } from '../add/AddSheet';
import { cleanup, fakeApi, fire, has, host, quietAccessibility, settle, tap } from '../add/testKit';
import { ActivityRowView } from './ActivityRowView';
import { SplitSheet, type SplitStart } from './SplitSheet';
import { TransactionDetailScreen } from './TransactionDetailScreen';
import type { TransactionApi, TransactionData } from './transactionApi';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Singapore' } }));

afterEach(cleanup);
beforeEach(quietAccessibility);
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'getRecommendedTimeoutMillis').mockImplementation(async (ms: number) => ms);
});

const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
const wait = (ms: number) => act(async () => new Promise((res) => setTimeout(res, ms)));
const type = (r: ReactTestRenderer, id: string, v: string) => act(() => r.root.findAll((n) => n.props.testID === id && typeof n.props.onChangeText === 'function')[0]!.props.onChangeText(v));
const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());
};

const CATS = [{ id: 'cat_groceries', name: 'Groceries' }, { id: 'cat_personal', name: 'Personal Care' }, { id: 'cat_food', name: 'Food & Drinks' }];
const start = (over: Partial<SplitStart> = {}): SplitStart => ({
  transactionId: 't1', totalMinor: 126_400, currency: 'INR', exponent: 2, locale: 'en-IN', categories: CATS, rows: [{ categoryId: 'cat_groceries', amountMinor: null }], ...over,
});

function mountSheet(s: SplitStart, onSave = jest.fn<Promise<{ ok: boolean; code?: string }>, [SplitRow[]]>(async () => ({ ok: true }))) {
  const close = jest.fn();
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <ThemeProvider>
        <SplitSheet start={s} onSave={onSave} close={close} />
      </ThemeProvider>,
    );
  });
  return { r, onSave, close, unmount: () => act(() => r.unmount()) };
}
const saveProps = (r: ReactTestRenderer) => host(r, 'split-save').props;
const left = (r: ReactTestRenderer) => host(r, 'left-to-assign').props.accessibilityLabel as string;

describe('the split editor (Story 3.7)', () => {
  it('opens with one row (Groceries, no amount), Add a row, and Left to assign the whole total', () => {
    const m = mountSheet(start());
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Left to assign', '₹1,264.00', 'Groceries', 'Add a row', 'Fill']));
    expect(left(m.r)).toBe('Left to assign 1,264 rupees');
    expect(host(m.r, 'left-to-assign').props.accessibilityLiveRegion).toBe('polite');
    m.unmount();
  });

  it('the live region reads the remainder only after typing pauses for 500 ms', async () => {
    const m = mountSheet(start());
    type(m.r, 'split-amount-0', '1000');
    expect(left(m.r)).toBe('Left to assign 1,264 rupees');
    await wait(520);
    expect(left(m.r)).toBe('Left to assign 264 rupees');
    m.unmount();
  });

  it('Fill gives the remainder to the focused row, labelled with the amount and category; Left to assign reads 0', async () => {
    const m = mountSheet(start({ rows: [{ categoryId: 'cat_groceries', amountMinor: 100_000 }] }));
    await press(m.r, 'split-add-row');
    // the new row picks the next unused category (Personal Care)
    expect(texts(m.r)).toContain('Personal Care');
    act(() => m.r.root.findAll((n) => n.props.testID === 'split-amount-1' && typeof n.props.onFocus === 'function')[0]!.props.onFocus());
    expect(host(m.r, 'split-fill').props.accessibilityLabel).toBe('Fill: assign 264 rupees to Personal Care');
    await press(m.r, 'split-fill');
    expect(host(m.r, 'split-amount-1').props.value).toBe('264');
    expect(left(m.r)).toBe('Left to assign 0 rupees');
    expect(saveProps(m.r).accessibilityState?.disabled).toBeFalsy();
    m.unmount();
  });

  it('with no row focused, Fill goes to the last row', async () => {
    const m = mountSheet(start({ rows: [{ categoryId: 'cat_groceries', amountMinor: 100_000 }, { categoryId: 'cat_personal', amountMinor: null }] }));
    await press(m.r, 'split-fill');
    expect(host(m.r, 'split-amount-1').props.value).toBe('264');
    m.unmount();
  });

  it('Save is disabled but focusable with the hint "Assign the remaining ₹X to save"; nothing balances by itself', () => {
    const m = mountSheet(start({ rows: [{ categoryId: 'cat_groceries', amountMinor: 100_000 }] }));
    expect(saveProps(m.r).accessibilityHint).toBe('Assign the remaining 264 rupees to save');
    expect(saveProps(m.r).accessibilityState).toMatchObject({ disabled: true });
    expect(host(m.r, 'split-amount-0').props.value).toBe('1000');
    m.unmount();
  });

  it('rows that exceed the total show a warning and "₹X too much"; Save stays disabled', async () => {
    const m = mountSheet(start({ rows: [{ categoryId: 'cat_groceries', amountMinor: 130_000 }] }));
    expect(has(m.r, 'too-much')).toBe(true);
    expect(texts(m.r)).toEqual(expect.arrayContaining(['₹36.00', 'too much']));
    await wait(520);
    expect(left(m.r)).toBe('Left to assign 36 rupees too much');
    expect(saveProps(m.r).accessibilityState).toMatchObject({ disabled: true });
    m.unmount();
  });

  it('saves exact rows in minor units, including the category chosen for a row, and closes', async () => {
    const m = mountSheet(start());
    type(m.r, 'split-amount-0', '1000');
    await press(m.r, 'split-add-row');
    await press(m.r, 'split-category-1');
    await press(m.r, 'split-pick-1-cat_personal');
    type(m.r, 'split-amount-1', '264');
    await press(m.r, 'split-save');
    await settle();
    expect(m.onSave).toHaveBeenCalledWith([{ categoryId: 'cat_groceries', amountMinor: 100_000 }, { categoryId: 'cat_personal', amountMinor: 26_400 }]);
    expect(m.close).toHaveBeenCalled();
    m.unmount();
  });

  it('removing rows down to one saves a single split for the full amount; a lone row has no Remove', async () => {
    const m = mountSheet(start({ rows: [{ categoryId: 'cat_groceries', amountMinor: 100_000 }, { categoryId: 'cat_personal', amountMinor: 26_400 }] }));
    await press(m.r, 'split-remove-1');
    expect(has(m.r, 'split-remove-0')).toBe(false);
    type(m.r, 'split-amount-0', '1264');
    await press(m.r, 'split-save');
    await settle();
    expect(m.onSave).toHaveBeenCalledWith([{ categoryId: 'cat_groceries', amountMinor: 126_400 }]);
    m.unmount();
  });

  it('a row with no amount blocks Save with a calm error; a failed save keeps the sheet open', async () => {
    const m = mountSheet(start({ rows: [{ categoryId: 'cat_groceries', amountMinor: 126_400 }, { categoryId: 'cat_personal', amountMinor: 0 }] }));
    await press(m.r, 'split-save');
    expect(texts(m.r)).toContain('Error: every row needs an amount');
    m.unmount();
    const f = mountSheet(start({ rows: [{ categoryId: 'cat_groceries', amountMinor: 126_400 }] }), jest.fn<Promise<{ ok: boolean; code?: string }>, [SplitRow[]]>(async () => ({ ok: false, code: 'SPLITS_DONT_SUM' })));
    await press(f.r, 'split-save');
    await settle();
    expect(texts(f.r)).toContain('Could not save the split.');
    expect(f.close).not.toHaveBeenCalled();
    f.unmount();
  });

  it('a Not itemised row is grey, cannot be edited or removed, and counts as assigned', async () => {
    const m = mountSheet(start({ rows: [{ categoryId: 'cat_groceries', amountMinor: 92_400 }, { categoryId: 'cat_uncategorised', amountMinor: 34_000, notItemised: true }] }));
    expect(texts(m.r)).toContain('Not itemised');
    expect(host(m.r, 'split-amount-1').props.editable).toBe(false);
    expect(has(m.r, 'split-remove-1')).toBe(false);
    expect(left(m.r)).toBe('Left to assign 0 rupees');
    await press(m.r, 'split-save');
    await settle();
    expect(m.onSave).toHaveBeenCalledWith([{ categoryId: 'cat_groceries', amountMinor: 92_400 }, { categoryId: 'cat_uncategorised', amountMinor: 34_000, memo: 'not_itemised' }]);
    m.unmount();
  });

  it('works in whole-unit (VND, like JPY) and three-decimal (KWD) currencies', async () => {
    const jpy = mountSheet(start({ currency: 'VND', exponent: 0, totalMinor: 1264, rows: [{ categoryId: 'cat_groceries', amountMinor: 1000 }, { categoryId: 'cat_personal', amountMinor: null }] }));
    await press(jpy.r, 'split-fill');
    expect(host(jpy.r, 'split-amount-1').props.value).toBe('264');
    await press(jpy.r, 'split-save');
    await settle();
    expect(jpy.onSave).toHaveBeenCalledWith([{ categoryId: 'cat_groceries', amountMinor: 1000 }, { categoryId: 'cat_personal', amountMinor: 264 }]);
    jpy.unmount();
    const kwd = mountSheet(start({ currency: 'KWD', exponent: 3, totalMinor: 1_264_500, rows: [{ categoryId: 'cat_groceries', amountMinor: 1_000_000 }, { categoryId: 'cat_personal', amountMinor: null }] }));
    await press(kwd.r, 'split-fill');
    expect(host(kwd.r, 'split-amount-1').props.value).toBe('264.5');
    kwd.unmount();
  });
});

describe('split entries elsewhere', () => {
  const detail = (over: Partial<TransactionDetail> = {}): TransactionDetail => ({
    id: 't1', type: 'expense', status: 'confirmed', amountMinor: 126_400, occurredAtMs: Date.UTC(2026, 10, 7, 13, 12), localDate: '2026-11-07', merchant: 'BigBasket', note: null, paymentMethod: null,
    resolution: 'user_approved', removed: false, category: { id: 'cat_groceries', name: 'Groceries', icon: 'ShoppingCart', color: 'cat-lime' }, splitCount: 2,
    from: { id: 'a1', name: 'HDFC' }, to: null, sourceKind: 'manual', addedAtMs: Date.UTC(2026, 10, 7, 13, 12), timezoneId: 'Asia/Kolkata', openDuplicate: false, ...over,
  });
  const splits: SplitView[] = [
    { id: 's1', categoryId: 'cat_groceries', categoryName: 'Groceries', icon: 'ShoppingCart', color: 'cat-lime', amountMinor: 100_000, notItemised: false },
    { id: 's2', categoryId: 'cat_personal', categoryName: 'Personal Care', icon: 'Flower', color: 'cat-rose', amountMinor: 26_400, notItemised: false },
  ];

  it('Activity reads "Groceries + 1 more · HDFC" and the detail lists each split with its amount and offers Split', async () => {
    const row: ActivityRow = { id: 'x', kind: 'expense', amountMinor: 126_400, localDate: '2026-11-07', merchant: 'BigBasket', categoryName: 'Groceries', categoryIcon: 'ShoppingCart', categoryColor: 'cat-lime', accountName: 'HDFC', splitCount: 2 };
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <ThemeProvider>
          <ActivityRowView row={row} date="2026-11-07" currency="INR" locale="en-IN" />
        </ThemeProvider>,
      );
    });
    expect(texts(r)).toContain('Groceries + 1 more · HDFC');
    act(() => r.unmount());
    void groupByDay;

    const load = jest.fn<Promise<TransactionData | 'missing' | null>, [string]>(async () => ({ currency: 'INR', exponent: 2, locale: 'en-IN', detail: detail(), splits, categories: CATS, recovery: { refundedMinor: 0, reimbursedMinor: 0 }, refundableMinor: null, reversedOn: null }));
    const api: TransactionApi = { load, remove: jest.fn() as never, restore: jest.fn() as never, setSplits: jest.fn() as never, refund: jest.fn() as never, reverse: jest.fn() as never, undoReverse: jest.fn() as never };
    const onSplit = jest.fn();
    const qc = createQueryClient();
    let d!: ReactTestRenderer;
    await act(async () => {
      d = create(
        <QueryClientProvider client={qc}>
          <ThemeProvider>
            <ToastHost bottomOffset={0}>
              <SheetHost>
                <TransactionDetailScreen transactionId="t1" onBack={() => undefined} onEdit={() => undefined} onDuplicate={() => undefined} onSplit={onSplit} api={api} />
              </SheetHost>
            </ToastHost>
          </ThemeProvider>
        </QueryClientProvider>,
      );
    });
    await settle();
    expect(texts(d)).toEqual(expect.arrayContaining(['Groceries + 1 more', 'Groceries', 'Personal Care', '₹1,000.00', '₹264.00', 'Split']));
    await act(async () => d.root.findAll((n) => n.props.testID === 'detail-split' && typeof n.props.onPress === 'function')[0]!.props.onPress());
    expect(onSplit).toHaveBeenCalledWith('t1');
    act(() => d.unmount());
    qc.clear();
  });

  it('editing the amount of a split entry hands over to the split editor instead of saving the amount alone', async () => {
    const onSplit = jest.fn();
    const spec = { transactionId: 't1', kind: 'expense' as const, amountMinor: 126_400, categoryId: 'cat_groceries', accountId: 'a1', toAccountId: null, merchant: 'BigBasket', note: null, paymentMethod: null, occurredAtMs: Date.UTC(2026, 10, 7, 1, 15), splitCount: 2 };
    const f = fakeApi();
    const qc = createQueryClient();
    const close = jest.fn();
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <QueryClientProvider client={qc}>
          <ThemeProvider>
            <ToastHost bottomOffset={0}>
              <SheetHost>
                <AddSheet api={f.api} close={close} edit={spec} onSplit={onSplit} now={() => Date.UTC(2026, 10, 8, 10, 0, 0)} />
              </SheetHost>
            </ToastHost>
          </ThemeProvider>
        </QueryClientProvider>,
      );
    });
    await settle();
    tap(r, '5');
    await act(async () => fire(r, 'save'));
    await settle();
    expect(f.editTx).not.toHaveBeenCalled();
    expect(onSplit).toHaveBeenCalledWith('t1', expect.any(Number));
    expect(close).toHaveBeenCalled();
    act(() => r.unmount());
    qc.clear();
  });
});
