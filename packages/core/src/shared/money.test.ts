import fc from 'fast-check';
import { SUPPORTED_CURRENCIES, getCurrency } from './currency';
import {
  addMinor,
  addMoney,
  formatMinorPlain,
  makeMoney,
  parseAmountInput,
  subtractMinor,
  subtractMoney,
} from './money';

const MAX = Number.MAX_SAFE_INTEGER;
const EXPONENTS = [0, 2, 3];

describe('currency table', () => {
  it.each([
    ['INR', 2],
    ['SGD', 2],
    ['JPY_NOT_SUPPORTED', -1],
  ])('%s', (code, exp) => {
    const r = getCurrency(code);
    if (exp < 0) expect(r).toEqual({ ok: false, code: 'CURRENCY_UNSUPPORTED' });
    else expect(r.ok && r.value.exponent).toBe(exp);
  });

  it('uses exponent 3 for BHD/KWD/OMR and whole units for IDR/HUF/VND', () => {
    for (const c of ['BHD', 'KWD', 'OMR']) expect(getCurrency(c)).toMatchObject({ ok: true, value: { exponent: 3 } });
    for (const c of ['IDR', 'HUF', 'VND']) expect(getCurrency(c)).toMatchObject({ ok: true, value: { exponent: 0 } });
  });

  it('lists every Phase 1 currency once', () => {
    const codes = SUPPORTED_CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toHaveLength(24);
  });

  it('rejects unknown and lowercase codes', () => {
    expect(getCurrency('XYZ')).toEqual({ ok: false, code: 'CURRENCY_UNSUPPORTED' });
    expect(getCurrency('inr')).toEqual({ ok: false, code: 'CURRENCY_UNSUPPORTED' });
    expect(getCurrency('')).toEqual({ ok: false, code: 'CURRENCY_UNSUPPORTED' });
  });
});

describe('parseAmountInput', () => {
  it('parses exact minor units', () => {
    expect(parseAmountInput('12.50', 2)).toEqual({ ok: true, value: 1250 });
    expect(parseAmountInput('12.5', 2)).toEqual({ ok: true, value: 1250 });
    expect(parseAmountInput('12', 2)).toEqual({ ok: true, value: 1200 });
    expect(parseAmountInput('.5', 2)).toEqual({ ok: true, value: 50 });
    expect(parseAmountInput('5.', 2)).toEqual({ ok: true, value: 500 });
    expect(parseAmountInput('0.001', 3)).toEqual({ ok: true, value: 1 });
    expect(parseAmountInput('1500', 0)).toEqual({ ok: true, value: 1500 });
    expect(parseAmountInput('007', 2)).toEqual({ ok: true, value: 700 });
  });

  it('rejects excess decimals and never rounds', () => {
    expect(parseAmountInput('12.505', 2)).toEqual({ ok: false, code: 'EXCESS_DECIMALS' });
    expect(parseAmountInput('1.5', 0)).toEqual({ ok: false, code: 'EXCESS_DECIMALS' });
    expect(parseAmountInput('0.0001', 3)).toEqual({ ok: false, code: 'EXCESS_DECIMALS' });
  });

  it.each(['', '   ', '.', 'NaN', 'Infinity', '-Infinity', 'abc', '1e5', '1,000', '1.2.3', '+5', '--1', '- 1', '٣'])(
    'invalid: %j',
    (t) => {
      expect(parseAmountInput(t, 2)).toEqual({ ok: false, code: 'AMOUNT_INVALID' });
    },
  );

  it('rejects negatives where a magnitude is expected', () => {
    expect(parseAmountInput('-5', 2)).toEqual({ ok: false, code: 'AMOUNT_NEGATIVE' });
    expect(parseAmountInput('-0.50', 2)).toEqual({ ok: false, code: 'AMOUNT_NEGATIVE' });
    expect(parseAmountInput('-', 2)).toEqual({ ok: false, code: 'AMOUNT_INVALID' });
  });

  it('handles the safe-integer boundary exactly', () => {
    expect(parseAmountInput('9007199254740991', 0)).toEqual({ ok: true, value: MAX });
    expect(parseAmountInput('9007199254740992', 0)).toEqual({ ok: false, code: 'AMOUNT_TOO_LARGE' });
    expect(parseAmountInput('90071992547409.91', 2)).toEqual({ ok: true, value: MAX });
    expect(parseAmountInput('90071992547409.92', 2)).toEqual({ ok: false, code: 'AMOUNT_TOO_LARGE' });
    expect(parseAmountInput('9'.repeat(400), 2)).toEqual({ ok: false, code: 'AMOUNT_TOO_LARGE' });
  });

  it('rejects an invalid exponent', () => {
    expect(parseAmountInput('1', -1)).toEqual({ ok: false, code: 'AMOUNT_INVALID' });
    expect(parseAmountInput('1', 1.5)).toEqual({ ok: false, code: 'AMOUNT_INVALID' });
  });
});

describe('makeMoney / arithmetic', () => {
  it('builds Money with the table exponent', () => {
    expect(makeMoney(1250, 'SGD')).toEqual({ ok: true, value: { amountMinor: 1250, currency: 'SGD', exponent: 2 } });
    expect(makeMoney(0.5, 'SGD')).toEqual({ ok: false, code: 'AMOUNT_INVALID' });
    expect(makeMoney(NaN, 'SGD')).toEqual({ ok: false, code: 'AMOUNT_INVALID' });
    expect(makeMoney(2 ** 60, 'SGD')).toEqual({ ok: false, code: 'AMOUNT_TOO_LARGE' });
    expect(makeMoney(1, 'ZZZ')).toEqual({ ok: false, code: 'CURRENCY_UNSUPPORTED' });
  });

  it('normalises negative zero', () => {
    const r = makeMoney(-0, 'INR');
    expect(r.ok && Object.is(r.value.amountMinor, 0)).toBe(true);
  });

  it('refuses mixed currencies', () => {
    const a = makeMoney(1, 'INR');
    const b = makeMoney(1, 'USD');
    if (!a.ok || !b.ok) throw new Error('setup');
    expect(addMoney(a.value, b.value)).toEqual({ ok: false, code: 'CURRENCY_MISMATCH' });
    expect(subtractMoney(a.value, b.value)).toEqual({ ok: false, code: 'CURRENCY_MISMATCH' });
  });

  it('returns AMOUNT_TOO_LARGE at the edge instead of a wrong number', () => {
    expect(addMinor(MAX, 1)).toEqual({ ok: false, code: 'AMOUNT_TOO_LARGE' });
    expect(addMinor(MAX - 1, 1)).toEqual({ ok: true, value: MAX });
    expect(subtractMinor(-MAX, 1)).toEqual({ ok: false, code: 'AMOUNT_TOO_LARGE' });
    expect(addMinor(1.5, 1)).toEqual({ ok: false, code: 'AMOUNT_INVALID' });
  });

  it('adds and subtracts Money values', () => {
    const a = makeMoney(1000, 'INR');
    const b = makeMoney(250, 'INR');
    if (!a.ok || !b.ok) throw new Error('setup');
    expect(addMoney(a.value, b.value)).toMatchObject({ ok: true, value: { amountMinor: 1250 } });
    expect(subtractMoney(b.value, a.value)).toMatchObject({ ok: true, value: { amountMinor: -750 } });
  });
});

describe('property suite (LIR-07, LIR-10)', () => {
  const safe = fc.integer({ min: 0, max: MAX });

  it('store -> format -> parse returns the original for every exponent', () => {
    for (const exp of EXPONENTS) {
      fc.assert(
        fc.property(safe, (n) => {
          const text = formatMinorPlain(n, exp);
          if (!text.ok) return false;
          const back = parseAmountInput(text.value, exp);
          return back.ok && back.value === n;
        }),
        { numRuns: 2000 },
      );
    }
  });

  it('round-trips across every supported currency', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SUPPORTED_CURRENCIES), safe, (cur, n) => {
        const t = formatMinorPlain(n, cur.exponent);
        const back = t.ok ? parseAmountInput(t.value, cur.exponent) : null;
        return back !== null && back.ok && back.value === n;
      }),
      { numRuns: 2000 },
    );
  });

  it('10,000 random add/subtract edits on large values equal the exact BigInt sum', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2 ** 52, max: MAX }),
        fc.array(fc.tuple(fc.boolean(), fc.integer({ min: 0, max: 2 ** 40 })), { minLength: 10000, maxLength: 10000 }),
        (start, edits) => {
          let cur = start;
          let exact = BigInt(start);
          for (const [add, delta] of edits) {
            const next = add ? addMinor(cur, delta) : subtractMinor(cur, delta);
            const nextExact = add ? exact + BigInt(delta) : exact - BigInt(delta);
            const inRange = nextExact <= BigInt(MAX) && nextExact >= -BigInt(MAX);
            if (!inRange) {
              if (next.ok || next.code !== 'AMOUNT_TOO_LARGE') return false;
              continue; // edit rejected, balance unchanged
            }
            if (!next.ok || next.value !== Number(nextExact)) return false;
            cur = next.value;
            exact = nextExact;
          }
          return BigInt(cur) === exact;
        },
      ),
      { numRuns: 5 },
    );
  });

  it('any out-of-range sum is AMOUNT_TOO_LARGE, never a wrong number', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: MAX }), fc.integer({ min: 1, max: MAX }), (a, b) => {
        const r = addMinor(a, b);
        const exact = BigInt(a) + BigInt(b);
        if (exact > BigInt(MAX)) return !r.ok && r.code === 'AMOUNT_TOO_LARGE';
        return r.ok && BigInt(r.value) === exact;
      }),
      { numRuns: 5000 },
    );
  });

  it('parse never rounds: excess decimals always fail', () => {
    fc.assert(
      fc.property(fc.constantFrom(0, 2, 3), fc.nat(1000), fc.integer({ min: 1, max: 5 }), (exp, whole, extra) => {
        const text = `${whole}.${'1'.repeat(exp + extra)}`;
        const r = parseAmountInput(text, exp);
        return !r.ok && r.code === 'EXCESS_DECIMALS';
      }),
    );
  });

  it('parse is total: any string yields a Result and never throws', () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom(0, 2, 3), (s, exp) => {
        const r = parseAmountInput(s, exp);
        return r.ok ? Number.isSafeInteger(r.value) && r.value >= 0 : typeof r.code === 'string';
      }),
      { numRuns: 5000 },
    );
  });
});
