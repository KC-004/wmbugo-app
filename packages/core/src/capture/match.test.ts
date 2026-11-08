import fc from 'fast-check';
import { assignOccurrenceIndex, daysApart, matchItem, transferPairWindowDays, type CaptureItem, type MatchContext } from './match';
import { normalizeMerchant } from './merchant';

const T0 = Date.UTC(2026, 10, 8, 10, 0, 0);
const MIN = 60_000;
const ctx: MatchContext = { ownedAccountIds: new Set(['hdfc', 'cash', 'sbi']) };

let n = 0;
const item = (over: Partial<CaptureItem> = {}): CaptureItem => ({
  id: `i${++n}`, reference: null, direction: 'debit', eventType: 'expense', amountMinor: 2000, localDate: '2026-11-08', occurredAtMs: T0,
  merchant: 'Tea Stall', accountId: 'hdfc', text: null, source: 'manual', ...over,
});

describe('merchant normalizer (LRN-009)', () => {
  it.each(['SWIGGY*BLR 8821', 'Swiggy', 'SWIGGY  ORDER 4410', '  swiggy  ', 'UPI-SWIGGY 99812', 'paytm*swiggy'])('%s -> swiggy', (raw) => {
    expect(normalizeMerchant(raw)).toBe('swiggy');
  });
  it('keeps real multi-word names and handles nothing', () => {
    expect(normalizeMerchant('Tea  Stall')).toBe('tea stall');
    expect(normalizeMerchant('Big Basket BLR')).toBe('big basket');
    expect(normalizeMerchant('')).toBe('');
    expect(normalizeMerchant(null)).toBe('');
    expect(normalizeMerchant('8821')).toBe('8821'); // never reduces a name to nothing
  });
});

describe('match outcomes (Story 3.1)', () => {
  it('the same reference, direction and type is a duplicate; different references never are, whatever else is equal', () => {
    const a = item({ reference: 'UPI123' });
    expect(matchItem(item({ reference: 'UPI123' }), [a], ctx)).toEqual({ kind: 'duplicate_of', id: a.id });
    expect(matchItem(item({ reference: 'UPI124' }), [a], ctx)).toEqual({ kind: 'no_match' });
  });

  it('two Rs 20 UPI payments to the same tea stall on consecutive days with different references are both new', () => {
    const day1 = item({ reference: 'R1', localDate: '2026-11-07', occurredAtMs: T0 - 86_400_000, source: 'upi' });
    expect(matchItem(item({ reference: 'R2', source: 'upi' }), [day1], ctx)).toEqual({ kind: 'no_match' });
  });

  it('same reference, opposite direction: same account or reversal text is a reversal; another owned account is a transfer; unknown is held', () => {
    const debit = item({ reference: 'X1', accountId: 'hdfc' });
    expect(matchItem(item({ reference: 'X1', direction: 'credit', eventType: 'income', accountId: 'hdfc' }), [debit], ctx)).toEqual({ kind: 'reversal_or_refund_of', id: debit.id });
    expect(matchItem(item({ reference: 'X1', direction: 'credit', eventType: 'income', accountId: 'cash', text: 'Payment failed, reversed' }), [debit], ctx)).toEqual({ kind: 'reversal_or_refund_of', id: debit.id });
    expect(matchItem(item({ reference: 'X1', direction: 'credit', eventType: 'income', accountId: 'cash' }), [debit], ctx)).toEqual({ kind: 'transfer_pair_with', id: debit.id });
    expect(matchItem(item({ reference: 'X1', direction: 'credit', eventType: 'income', accountId: null }), [debit], ctx)).toEqual({
      kind: 'held_pair', id: debit.id, question: 'Reversal, or a transfer between your accounts?',
    });
  });

  it('no reference: equal amount, date within a day and the same normalized merchant is a possible duplicate', () => {
    const a = item({ merchant: 'SWIGGY*BLR 8821', amountMinor: 45000, source: 'card' });
    expect(matchItem(item({ merchant: 'Swiggy', amountMinor: 45000, localDate: '2026-11-09', source: 'sms' }), [a], ctx)).toEqual({ kind: 'possible_duplicate_of', id: a.id });
    expect(matchItem(item({ merchant: 'Swiggy', amountMinor: 45000, localDate: '2026-11-10', source: 'sms' }), [a], ctx)).toEqual({ kind: 'no_match' });
    expect(matchItem(item({ merchant: 'Zomato', amountMinor: 45000, source: 'sms' }), [a], ctx)).toEqual({ kind: 'no_match' });
  });

  it('a receipt matches a card charge up to 30% higher: 1,000 vs 1,150 yes, 1,000 vs 1,301 no; an item with no merchant never fuzzy-matches', () => {
    const receipt = item({ source: 'receipt', amountMinor: 100000, merchant: 'Cafe Z' });
    const near = item({ source: 'card', amountMinor: 115000, merchant: 'CAFE Z BLR' });
    const far = item({ source: 'card', amountMinor: 130100, merchant: 'Cafe Z' });
    expect(matchItem(near, [receipt], ctx)).toEqual({ kind: 'possible_duplicate_of', id: receipt.id });
    expect(matchItem(item({ source: 'card', amountMinor: 130000, merchant: 'Cafe Z' }), [receipt], ctx).kind).toBe('possible_duplicate_of');
    expect(matchItem(far, [receipt], ctx)).toEqual({ kind: 'no_match' });
    expect(matchItem(item({ source: 'card', amountMinor: 100000, merchant: null }), [receipt], ctx)).toEqual({ kind: 'no_match' });
    expect(matchItem(item({ source: 'card', amountMinor: 90000, merchant: 'Cafe Z' }), [receipt], ctx)).toEqual({ kind: 'no_match' }); // lower is not a tip
  });

  it('two manual entries of the same amount at the same merchant within 10 minutes are a possible duplicate; 40 minutes apart are two teas', () => {
    const first = item({ occurredAtMs: T0 });
    expect(matchItem(item({ occurredAtMs: T0 + 9 * MIN }), [first], ctx)).toEqual({ kind: 'possible_duplicate_of', id: first.id });
    expect(matchItem(item({ occurredAtMs: T0 + 40 * MIN }), [first], ctx)).toEqual({ kind: 'no_match' });
  });

  it('a debit and a credit of equal amounts on two owned accounts pair within 3 days for captures and 2 for CSV, even with different references', () => {
    const out = item({ reference: 'A', accountId: 'hdfc', amountMinor: 500000, localDate: '2026-11-05', source: 'sms', merchant: null });
    const into = (over: Partial<CaptureItem>) => item({ reference: 'B', direction: 'credit', eventType: 'income', accountId: 'sbi', amountMinor: 500000, merchant: null, source: 'sms', ...over });
    expect(matchItem(into({ localDate: '2026-11-08' }), [out], ctx)).toEqual({ kind: 'transfer_pair_with', id: out.id });
    expect(matchItem(into({ localDate: '2026-11-09' }), [out], ctx)).toEqual({ kind: 'no_match' });
    const csvOut = item({ ...out, id: 'c1', source: 'csv', fileId: 'f1' });
    expect(matchItem(into({ localDate: '2026-11-07', source: 'csv', fileId: 'f2' }), [csvOut], ctx).kind).toBe('transfer_pair_with');
    expect(matchItem(into({ localDate: '2026-11-08', source: 'csv', fileId: 'f2' }), [csvOut], ctx)).toEqual({ kind: 'no_match' });
    expect(transferPairWindowDays('csv')).toBe(2);
    expect(transferPairWindowDays('sms')).toBe(3);
  });

  it('removed on purpose: a tombstone with the same reference, or the same amount, date and merchant, is previously_removed', () => {
    const t = { reference: 'GONE1', amountMinor: 2000, localDate: '2026-11-08', merchantKey: 'tea stall' };
    expect(matchItem(item({ reference: 'GONE1' }), [], { ...ctx, tombstones: [t] })).toEqual({ kind: 'previously_removed' });
    expect(matchItem(item({ reference: 'OTHER' }), [], { ...ctx, tombstones: [t] })).toEqual({ kind: 'no_match' });
    expect(matchItem(item({ reference: null }), [], { ...ctx, tombstones: [{ ...t, reference: null }] })).toEqual({ kind: 'previously_removed' });
  });
});

describe('CSV rows', () => {
  it('rows of the same file never match each other or each other-committed rows from that file', () => {
    const a = item({ source: 'csv', fileId: 'f1', merchant: 'Tea', occurrence: 0 });
    const b = item({ source: 'csv', fileId: 'f1', merchant: 'Tea', occurrence: 1 });
    expect(matchItem(b, [a], ctx)).toEqual({ kind: 'no_match' });
    const fromOtherFile = item({ source: 'csv', fileId: 'f2', merchant: 'Tea', occurrence: 0 });
    expect(matchItem(fromOtherFile, [a], ctx).kind).toBe('possible_duplicate_of');
  });

  it('identical rows get an occurrence index, so the Nth identical row is its own row', () => {
    expect(assignOccurrenceIndex([
      { localDate: '2026-11-08', amountMinor: 2000, description: 'TEA' },
      { localDate: '2026-11-08', amountMinor: 2000, description: 'tea ' },
      { localDate: '2026-11-08', amountMinor: 3000, description: 'TEA' },
      { localDate: '2026-11-08', amountMinor: 2000, description: 'TEA' },
    ])).toEqual([0, 1, 0, 2]);
    const committed = item({ source: 'csv', fileId: 'f1', merchant: 'Tea', occurrence: 0 });
    expect(matchItem(item({ source: 'csv', fileId: 'f2', merchant: 'Tea', occurrence: 1 }), [committed], ctx)).toEqual({ kind: 'no_match' });
    expect(matchItem(item({ source: 'csv', fileId: 'f2', merchant: 'Tea', occurrence: 0 }), [committed], ctx).kind).toBe('possible_duplicate_of');
  });

  it('a row on a partly covered first or last day is held for review, never skipped or added', () => {
    const partial: MatchContext = { ...ctx, partialDays: new Set(['2026-11-08']) };
    expect(matchItem(item({ source: 'csv', fileId: 'f1', merchant: 'Tea' }), [], partial)).toEqual({
      kind: 'held_pair', id: null, question: 'This day is only partly in the file. Is it already recorded?',
    });
    const existing = item({ source: 'sms', merchant: 'Tea Stall' });
    expect(matchItem(item({ source: 'csv', fileId: 'f1', merchant: 'Tea Stall' }), [existing], partial)).toMatchObject({ kind: 'held_pair', id: existing.id });
    expect(matchItem(item({ source: 'csv', fileId: 'f1', merchant: 'Tea', localDate: '2026-11-07' }), [], partial)).toEqual({ kind: 'no_match' });
  });
});

describe('dedup properties (AD-18)', () => {
  const arbItem = fc.record({
    reference: fc.option(fc.constantFrom('A', 'B', 'C'), { nil: null }),
    direction: fc.constantFrom('debit' as const, 'credit' as const),
    amountMinor: fc.constantFrom(1000, 2000, 2500),
    day: fc.integer({ min: 5, max: 9 }),
    merchant: fc.option(fc.constantFrom('Tea Stall', 'SWIGGY*BLR 1234', 'Swiggy'), { nil: null }),
    accountId: fc.option(fc.constantFrom('hdfc', 'cash', 'sbi'), { nil: null }),
    source: fc.constantFrom('manual' as const, 'receipt' as const, 'card' as const, 'sms' as const, 'upi' as const),
    minute: fc.integer({ min: 0, max: 90 }),
  });
  type Sample = {
    reference: string | null;
    direction: 'debit' | 'credit';
    amountMinor: number;
    day: number;
    merchant: string | null;
    accountId: string | null;
    source: CaptureItem['source'];
    minute: number;
  };
  const make = (r: Sample, id: string): CaptureItem => ({
    id, reference: r.reference, direction: r.direction, eventType: r.direction === 'debit' ? 'expense' : 'income', amountMinor: r.amountMinor,
    localDate: `2026-11-0${r.day}`, occurredAtMs: T0 + r.minute * MIN, merchant: r.merchant, accountId: r.accountId, text: null, source: r.source,
  });

  it('is deterministic and does not depend on the order of the existing items', () => {
    fc.assert(
      fc.property(arbItem, fc.array(arbItem, { maxLength: 6 }), (a, others) => {
        const item1 = make(a, 'new');
        const existing = others.map((o, i) => make(o, `e${i}`));
        const one = matchItem(item1, existing, ctx);
        expect(matchItem(item1, existing, ctx)).toEqual(one);
        expect(matchItem(item1, [...existing].reverse(), ctx)).toEqual(one);
      }),
      { numRuns: 300 },
    );
  });

  it('duplicates are symmetric', () => {
    fc.assert(
      fc.property(arbItem, arbItem, (x, y) => {
        const a = make(x, 'a');
        const b = make(y, 'b');
        const ab = matchItem(a, [b], ctx);
        const ba = matchItem(b, [a], ctx);
        expect(ab.kind === 'duplicate_of').toBe(ba.kind === 'duplicate_of');
      }),
      { numRuns: 300 },
    );
  });

  it('differing references in the same direction never match, whatever the amount, date or merchant', () => {
    fc.assert(
      fc.property(arbItem, arbItem, (x, y) => {
        fc.pre(x.reference !== null && y.reference !== null && x.reference !== y.reference && x.direction === y.direction);
        expect(matchItem(make(x, 'a'), [make(y, 'b')], ctx)).toEqual({ kind: 'no_match' });
      }),
      { numRuns: 300 },
    );
  });

  it('rows of the same CSV file never match', () => {
    fc.assert(
      fc.property(arbItem, fc.array(arbItem, { maxLength: 5 }), (x, ys) => {
        const a = { ...make(x, 'a'), source: 'csv' as const, fileId: 'f' };
        const others = ys.map((y, i) => ({ ...make(y, `b${i}`), source: 'csv' as const, fileId: 'f' }));
        expect(matchItem(a, others, ctx)).toEqual({ kind: 'no_match' });
      }),
      { numRuns: 200 },
    );
  });

  it('daysApart is symmetric and counts calendar days', () => {
    expect(daysApart('2026-11-30', '2026-12-01')).toBe(1);
    expect(daysApart('2026-12-01', '2026-11-30')).toBe(1);
    expect(daysApart('2026-02-28', '2026-03-01')).toBe(1);
  });
});
