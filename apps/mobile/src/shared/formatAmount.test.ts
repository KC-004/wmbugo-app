import fc from 'fast-check';
import { SUPPORTED_CURRENCIES, formatMinorPlain, parseAmountInput } from '@wmbugo/core';
import { formatAmount } from './formatAmount';

const fmt = (amountMinor: number, currency: string, direction: 'expense' | 'income' | 'neutral' = 'expense', locale?: string) => {
  const r = formatAmount({ amountMinor, currency, direction, locale });
  if (!r.ok) throw new Error(r.code);
  return r.value.replace(new RegExp("[" + String.fromCharCode(160, 8239) + "]", "g"), " ");
};

describe('formatAmount', () => {
  it('INR uses lakh grouping', () => {
    expect(fmt(1186000000, 'INR')).toBe('₹1,18,60,000.00');
  });

  it('SGD shows S$ and exact decimals', () => {
    expect(fmt(123450, 'SGD')).toBe('S$1,234.50');
    expect(fmt(123450, 'SGD', 'expense', 'en-US')).toBe('S$1,234.50');
  });

  it('EUR in de-DE uses decimal comma and trailing symbol', () => {
    expect(fmt(123450, 'EUR', 'expense', 'de-DE')).toBe('1.234,50 €');
  });

  it('JPY-style whole units show 0 minor digits; BHD shows 3', () => {
    expect(fmt(1500, 'IDR', 'expense', 'id-ID')).not.toMatch(/[.,]\d{2}$/);
    expect(fmt(1500, 'HUF', 'expense', 'hu-HU')).toMatch(/1\s?500/);
    expect(fmt(1234500, 'BHD')).toMatch(/1,234\.500$/);
  });

  it('income gets a plus; expense and neutral are unsigned', () => {
    expect(fmt(500, 'USD', 'income')).toBe('+$5.00');
    expect(fmt(500, 'USD', 'expense')).toBe('$5.00');
    expect(fmt(500, 'USD', 'neutral')).toBe('$5.00');
  });

  it('negative input is treated as a magnitude, never printed with a minus', () => {
    expect(fmt(-500, 'USD')).toBe('$5.00');
    expect(fmt(-500, 'USD', 'income')).toBe('+$5.00');
  });

  it('handles zero and the safe-integer maximum exactly', () => {
    expect(fmt(0, 'USD')).toBe('$0.00');
    expect(fmt(Number.MAX_SAFE_INTEGER, 'USD', 'expense', 'en-US')).toBe('$90,071,992,547,409.91');
    expect(fmt(Number.MAX_SAFE_INTEGER, 'IDR', 'expense', 'en-US')).toMatch(/9,007,199,254,740,991$/);
  });

  it('small fractions keep their leading zeros', () => {
    expect(fmt(5, 'USD')).toBe('$0.05');
    expect(fmt(7, 'BHD')).toMatch(/0\.007$/);
  });

  it('rejects unsupported currency and unsafe amounts', () => {
    expect(formatAmount({ amountMinor: 1, currency: 'XXX', direction: 'expense' })).toEqual({ ok: false, code: 'CURRENCY_UNSUPPORTED' });
    expect(formatAmount({ amountMinor: 1.5, currency: 'USD', direction: 'expense' })).toEqual({ ok: false, code: 'AMOUNT_INVALID' });
    expect(formatAmount({ amountMinor: 2 ** 60, currency: 'USD', direction: 'expense' })).toEqual({ ok: false, code: 'AMOUNT_INVALID' });
  });

  it('falls back to en-US for an invalid locale instead of throwing', () => {
    expect(fmt(100, 'USD', 'expense', 'not_a_locale!!')).toBe('$1.00');
  });
});

describe('formatAmount properties', () => {
  const dirs = fc.constantFrom('expense', 'income', 'neutral' as const);
  const locales = ['en-IN', 'en-US', 'de-DE', 'sv-SE', 'nb-NO', 'fr-FR', 'ar-SA', 'th-TH', 'pl-PL', 'de-CH'];

  it('never emits a minus sign for any safe integer, currency, locale or direction', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
        fc.constantFrom(...SUPPORTED_CURRENCIES.map((c) => c.code)),
        fc.constantFrom(...locales),
        dirs,
        (n, currency, locale, direction) => {
          const r = formatAmount({ amountMinor: n, currency, direction, locale });
          return r.ok && !/[-−‒-―]/.test(r.value);
        },
      ),
      { numRuns: 3000 },
    );
  });

  it('formatted digits equal the exact canonical digits (nothing rounded or lost)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), fc.constantFrom(...SUPPORTED_CURRENCIES), (n, cur) => {
        const r = formatAmount({ amountMinor: n, currency: cur.code, direction: 'neutral', locale: 'en-US' });
        const plain = formatMinorPlain(n, cur.exponent);
        if (!r.ok || !plain.ok) return false;
        const digits = (s: string): string => s.replace(/\D/g, '');
        const back = parseAmountInput(plain.value, cur.exponent);
        return digits(r.value) === digits(plain.value) && back.ok && back.value === n;
      }),
      { numRuns: 3000 },
    );
  });
});
