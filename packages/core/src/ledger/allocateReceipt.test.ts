import * as fc from 'fast-check';
import type { ReceiptCharge, ReceiptDraft, ReceiptItem } from '../capture/receipt/types';
import { allocateReceipt, toSplits } from './allocateReceipt';
import { NOT_ITEMISED_MEMO, leftToAssign } from './splits';
import { UNCATEGORISED_ID } from './categories';

const item = (name: string, amountMinor: number, discountMinor = 0, lineIndex = 0): ReceiptItem => ({ name, amountMinor, discountMinor, lineIndex, certainty: 'sure' });
const charge = (label: string, value: number): ReceiptCharge => ({ label, value, certainty: 'sure' });

function draft(p: { items?: ReceiptItem[]; taxes?: number[]; fees?: number[]; discounts?: number[]; total: number | null }): ReceiptDraft {
  return {
    merchant: { value: 'Shop', certainty: 'sure' },
    date: { value: '2026-01-02', certainty: 'sure' },
    time: { value: null, certainty: 'missing' },
    currency: { value: 'SGD', certainty: 'sure' },
    subtotal: { value: null, certainty: 'missing' },
    taxes: (p.taxes ?? []).map((v) => charge('Tax', v)),
    fees: (p.fees ?? []).map((v) => charge('Fee', v)),
    discounts: (p.discounts ?? []).map((v) => charge('Discount', v)),
    total: p.total === null ? { value: null, certainty: 'missing' } : { value: p.total, certainty: 'sure' },
    items: p.items ?? [],
    unparsedLineCount: 0,
  };
}

describe('allocateReceipt (Story 10.3)', () => {
  it('shares a whole-bill discount: S$42.00 Groceries and S$18.00 Household, Member discount S$6.00, total S$54.00', () => {
    const a = allocateReceipt(draft({ items: [item('Rice', 4200), item('Soap', 1800)], discounts: [600], total: 5400 }), ['groceries', 'household'], 'groceries');
    expect(a.state).toBe('reconciled');
    expect(a.categoryTotals).toEqual({ groceries: 3780, household: 1620 });
    expect(a.notItemised).toBe(0);
    expect(a.mismatch).toBe(0);
  });

  it('applies a discount printed under an item to that item only', () => {
    const a = allocateReceipt(draft({ items: [item('Jacket', 5000, 500), item('Shirt', 2000)], total: 6500 }), ['a', 'b'], 'a');
    expect(a.state).toBe('reconciled');
    expect(a.items.map((i) => i.allocatedAmount)).toEqual([4500, 2000]);
  });

  it('spreads tax and fees in proportion, rounds down and gives the remaining minor units to the largest item (first on a tie)', () => {
    const a = allocateReceipt(draft({ items: [item('A', 100), item('B', 100), item('C', 100)], taxes: [10], total: 310 }), ['x', 'x', 'x'], 'x');
    expect(a.items.map((i) => i.allocatedAmount)).toEqual([104, 103, 103]);
    const b = allocateReceipt(draft({ items: [item('A', 100), item('B', 300)], taxes: [5], fees: [3], total: 408 }), ['x', 'y'], 'x');
    // tax 5: A 1, B 3, leftover 1 to B; fees 3: A 0, B 2, leftover 1 to B; so A 101 and B 307.
    expect(b.items.map((i) => i.allocatedAmount)).toEqual([101, 307]);
    expect(b.state).toBe('reconciled');
  });

  it('puts what was not itemised in its own amount that takes no tax, fees or discounts', () => {
    // 14 lines on the receipt, 12 read: 12 x 10.00 = 120.00, tax 12.00, total 150.00, so 18.00 was not itemised.
    const items = Array.from({ length: 12 }, (_, i) => item(`I${i}`, 1000, 0, i));
    const a = allocateReceipt(draft({ items, taxes: [1200], total: 15000 }), [], 'main');
    expect(a.state).toBe('not_itemised');
    expect(a.notItemised).toBe(1800);
    expect(a.categoryTotals).toEqual({ main: 13200 });
    const splits = toSplits(a);
    expect(splits).toEqual([
      { categoryId: 'main', amountMinor: 13200 },
      { categoryId: UNCATEGORISED_ID, amountMinor: 1800, memo: NOT_ITEMISED_MEMO },
    ]);
    expect(leftToAssign(15000, splits.map((s) => s.amountMinor))).toBe(0);
  });

  it('is a mismatch with the excess when what was read is above the total, and gives no splits', () => {
    const a = allocateReceipt(draft({ items: [item('A', 1000), item('B', 1000)], total: 1800 }), ['x', 'x'], 'x');
    expect(a.state).toBe('mismatch');
    expect(a.mismatch).toBe(200);
    expect(a.notItemised).toBe(0);
    expect(toSplits(a)).toEqual([]);
  });

  it('is a mismatch, never a negative row, when a discount is larger than its item or than everything', () => {
    const a = allocateReceipt(draft({ items: [item('A', 500, 800), item('B', 1000)], total: 1000 }), ['x', 'y'], 'x');
    expect(a.state).toBe('mismatch');
    expect(a.mismatch).toBe(300);
    expect(a.items.every((i) => i.allocatedAmount >= 0)).toBe(true);
    const b = allocateReceipt(draft({ items: [item('A', 500)], discounts: [900], total: 100 }), ['x'], 'x');
    expect(b.state).toBe('mismatch');
    expect(b.items.every((i) => i.allocatedAmount >= 0)).toBe(true);
  });

  it('puts the whole total in the main category, with no Not itemised row, when no items were read', () => {
    const a = allocateReceipt(draft({ total: 4250 }), [], 'groceries');
    expect(a).toEqual({ state: 'reconciled', notItemised: 0, mismatch: 0, items: [], categoryTotals: { groceries: 4250 } });
    expect(toSplits(a)).toEqual([{ categoryId: 'groceries', amountMinor: 4250 }]);
  });

  it('gives nothing to save when there is no total and no items', () => {
    const a = allocateReceipt(draft({ total: null }), [], 'x');
    expect(a.state).toBe('mismatch');
    expect(toSplits(a)).toEqual([]);
  });

  it('treats a missing total as what was read adding up, and uses the main category where an item has none', () => {
    const a = allocateReceipt(draft({ items: [item('A', 300), item('B', 200)], taxes: [50], total: null }), ['food', null], 'other');
    expect(a.state).toBe('reconciled');
    expect(a.categoryTotals).toEqual({ food: 330, other: 220 });
  });

  it('shares over amounts above 2^53 / 100 without losing minor units', () => {
    const big = 90_000_000_000_000; // 9e13 minor units
    const a = allocateReceipt(draft({ items: [item('A', big), item('B', big / 3)], taxes: [1_000_000_007], total: big + big / 3 + 1_000_000_007 }), ['x', 'y'], 'x');
    expect(a.state).toBe('reconciled');
    expect(a.items.reduce((n, i) => n + i.allocatedAmount, 0)).toBe(big + big / 3 + 1_000_000_007);
  });
});

describe('allocateReceipt edge cases', () => {
  it('does not call a receipt that adds up a mismatch because each charge rounds down on its own', () => {
    // items 1 and 9, tax 9, fees 9, discount 27, total 1: the 1-unit item gets 0 tax, 0 fee and 2 of the discount.
    const a = allocateReceipt(draft({ items: [item('A', 1), item('B', 9)], taxes: [9], fees: [9], discounts: [27], total: 1 }), ['x', 'y'], 'x');
    expect(a.state).toBe('reconciled');
    expect(a.items.every((i) => i.allocatedAmount >= 0)).toBe(true);
    expect(a.items.reduce((n, i) => n + i.allocatedAmount, 0)).toBe(1);
  });

  it('shares tax equally when every item was discounted to nothing, and a whole-bill discount then is a mismatch', () => {
    const a = allocateReceipt(draft({ items: [item('A', 500, 500), item('B', 300, 300)], taxes: [101], total: 101 }), ['x', 'y'], 'x');
    expect(a.state).toBe('reconciled');
    expect(a.items.map((i) => i.allocatedAmount)).toEqual([51, 50]);
    const b = allocateReceipt(draft({ items: [item('A', 500, 500)], discounts: [100], total: 0 }), ['x'], 'x');
    expect(b.state).toBe('mismatch');
  });

  it('keeps the printed order of categories in the splits even when ids look like numbers', () => {
    const a = allocateReceipt(draft({ items: [item('A', 100), item('B', 100), item('C', 100)], total: 300 }), ['zeta', '12', 'alpha'], 'zeta');
    expect(toSplits(a).map((s) => s.categoryId)).toEqual(['zeta', '12', 'alpha']);
  });
});

describe('allocateReceipt bad input', () => {
  it('reports a mismatch for amounts that are not whole non-negative minor units, and treats an empty category id as none', () => {
    expect(allocateReceipt(draft({ items: [item('A', 10.5)], total: 11 }), ['x'], 'x').state).toBe('mismatch');
    expect(allocateReceipt(draft({ items: [item('A', 100)], taxes: [-5], total: 95 }), ['x'], 'x').state).toBe('mismatch');
    const a = allocateReceipt(draft({ items: [item('A', 100)], total: 100 }), [''], 'main');
    expect(a.categoryTotals).toEqual({ main: 100 });
  });
});

describe('allocateReceipt properties', () => {
  // A currency exponent only changes the size of a minor unit, so the same laws are run over small and large amounts (INR 2 digits, JPY 0, KWD 3).
  const cats = ['a', 'b', 'c'];
  const arb = (maxItem: number) =>
    fc
      .record({
        items: fc.array(fc.record({ amount: fc.integer({ min: 1, max: maxItem }), cat: fc.constantFrom(...cats) }), { minLength: 1, maxLength: 14 }),
        tax: fc.integer({ min: 0, max: maxItem }),
        fee: fc.integer({ min: 0, max: maxItem }),
        discount: fc.integer({ min: 0, max: maxItem }),
        unread: fc.integer({ min: 0, max: maxItem }),
      })
      .map((r) => ({ ...r, expected: r.items.reduce((n, i) => n + i.amount, 0) + r.tax + r.fee - r.discount }))
      .filter((r) => r.expected > 0);

  it.each([
    ['amounts the size of INR prices (2 digits)', 1_000_000],
    ['amounts the size of JPY prices (0 digits)', 50_000],
    ['amounts the size of KWD prices (3 digits)', 100_000_000],
  ])('%s: category totals plus Not itemised equal the total, nothing is negative, Not itemised holds no tax, fees or discounts', (_n, maxItem) => {
    fc.assert(
      fc.property(arb(maxItem), (r) => {
        const total = r.expected + r.unread;
        const d = draft({ items: r.items.map((i, k) => item(`I${k}`, i.amount, 0, k)), taxes: [r.tax], fees: [r.fee], discounts: [r.discount], total });
        const a = allocateReceipt(d, r.items.map((i) => i.cat), 'a');
        expect(a.state).not.toBe('mismatch'); // every generated receipt adds up, so a mismatch here would be a false alarm
        const catSum = Object.values(a.categoryTotals).reduce((n, v) => n + v, 0);
        expect(catSum + a.notItemised).toBe(total);
        expect(a.items.every((i) => i.allocatedAmount >= 0)).toBe(true);
        expect(a.notItemised).toBe(r.unread); // the unread part is exactly what the receipt did not show, never reduced or grown by tax, fees or discounts
        expect(a.state).toBe(r.unread === 0 ? 'reconciled' : 'not_itemised');
        const splits = toSplits(a);
        expect(splits.every((s) => Number.isSafeInteger(s.amountMinor) && s.amountMinor > 0)).toBe(true);
        expect(leftToAssign(total, splits.map((s) => s.amountMinor))).toBe(0);
      }),
      { numRuns: 300 },
    );
  });
});
