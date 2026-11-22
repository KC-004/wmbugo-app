import type { ReceiptDraft } from '@wmbugo/core';

/**
 * A made-up receipt for opening the review in the debug build until the photo flow arrives (Story 10.6). Not shown in release builds.
 * The total is deliberately `unsure` and the date `unsure`, so both warnings can be seen.
 */
export function sampleReceiptDraft(currency: string, exponent: number): ReceiptDraft {
  const u = 10 ** exponent;
  const m = (n: number) => Math.round(n * u);
  return {
    merchant: { value: 'Sample Fresh Mart', certainty: 'sure' },
    date: { value: null, certainty: 'missing' },
    time: { value: null, certainty: 'missing' },
    currency: { value: currency, certainty: 'sure' },
    subtotal: { value: m(60), certainty: 'sure' },
    taxes: [],
    fees: [],
    discounts: [{ label: 'Member discount', value: m(6), certainty: 'sure' }],
    total: { value: m(54), certainty: 'unsure' },
    items: [
      { name: 'Rice 5kg', amountMinor: m(42), discountMinor: 0, lineIndex: 0, certainty: 'sure' },
      { name: 'Dish soap', amountMinor: m(18), discountMinor: 0, lineIndex: 1, certainty: 'sure' },
    ],
    unparsedLineCount: 0,
  };
}
