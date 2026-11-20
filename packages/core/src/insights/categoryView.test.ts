import fc from 'fast-check';
import { categoryView, OTHER_SEGMENT_ID, sharesOf } from './categoryView';
import type { CategorySpend } from './spending';

const cat = (id: string, spent: number, back = 0): CategorySpend => ({ categoryId: id, name: id, icon: 'Tag', colorToken: 'cat-rose', displayMinor: spent, backMinor: back });

describe('categoryView (Story 7.4, INS-012)', () => {
  it('the November fixture: Rent 53%, Food 29%, Fuel 12%, Not classified 6%, Shopping listed as ₹7,000 back with no share', () => {
    const v = categoryView([cat('rent', 1_800_000), cat('food', 1_000_000), cat('fuel', 400_000), cat('nc', 200_000), cat('shop', 0, 700_000)]);
    expect(v.ranked.map((r) => [r.categoryId, r.sharePercent])).toEqual([['rent', 53], ['food', 29], ['fuel', 12], ['nc', 6]]);
    expect(v.ranked.reduce((s, r) => s + r.sharePercent, 0)).toBe(100);
    expect(v.eligibleMinor).toBe(3_400_000);
    expect(v.surplus.map((s) => [s.categoryId, s.backMinor])).toEqual([['shop', 700_000]]);
    expect(v.donut.map((d) => d.id)).toEqual(['rent', 'food', 'fuel', 'nc']);
  });

  it('the shares add to 100 even when the rounding would not (a third each)', () => {
    expect(sharesOf([1, 1, 1])).toEqual([34, 33, 33]);
    expect(sharesOf([1, 1, 1]).reduce((s, x) => s + x, 0)).toBe(100);
    expect(sharesOf([])).toEqual([]);
    expect(sharesOf([0, 0])).toEqual([0, 0]);
  });

  it('a donut has at most six named segments; the rest fold into Other with their categories kept', () => {
    const rows = Array.from({ length: 10 }, (_, i) => cat(`c${i}`, 1000 - i * 10));
    const v = categoryView(rows);
    expect(v.donut).toHaveLength(7);
    const other = v.donut.at(-1)!;
    expect(other.id).toBe(OTHER_SEGMENT_ID);
    expect(other.members).toHaveLength(4);
    expect(v.donut.reduce((s, d) => s + d.sharePercent, 0)).toBe(100);
    expect(other.amountMinor).toBe(rows.slice(6).reduce((s, r) => s + r.displayMinor, 0));
  });

  it('no spending gives no ranked rows and no donut; one category is a full ring at 100%', () => {
    expect(categoryView([])).toMatchObject({ ranked: [], donut: [], eligibleMinor: 0 });
    const one = categoryView([cat('food', 5000)]);
    expect(one.ranked[0]!.sharePercent).toBe(100);
    expect(one.donut).toHaveLength(1);
  });

  it('a refund-surplus category never becomes a donut segment or a ranked row', () => {
    const v = categoryView([cat('a', 1000), cat('shop', 0, 5000)]);
    expect(v.donut.map((d) => d.id)).toEqual(['a']);
    expect(v.ranked.map((r) => r.categoryId)).toEqual(['a']);
  });

  it('property: ranked shares add to exactly 100 and each is within one point of its true share', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 12 }), (amounts) => {
        const shares = sharesOf(amounts);
        expect(shares.reduce((s, x) => s + x, 0)).toBe(100);
        const total = amounts.reduce((s, a) => s + a, 0);
        amounts.forEach((a, i) => expect(Math.abs(shares[i]! - (a * 100) / total)).toBeLessThan(1));
      }),
    );
  });
});
