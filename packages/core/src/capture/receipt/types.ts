export type Certainty = 'sure' | 'unsure' | 'missing';

/** One value read from a receipt and how far to trust it. A `missing` field has a null value. */
export interface ReceiptField<T> {
  readonly value: T | null;
  readonly certainty: Certainty;
}

/** A labelled amount (a tax, a fee or a whole-bill discount). Amounts are positive minor units; a discount is the amount taken off. */
export interface ReceiptCharge {
  readonly label: string;
  readonly value: number;
  readonly certainty: Certainty;
}

export interface ReceiptItem {
  readonly name: string;
  /** The printed line amount, minor units, before the item's own discount. */
  readonly amountMinor: number;
  /** A discount printed directly under the item (positive minor units taken off), 0 when none. */
  readonly discountMinor: number;
  /** Zero-based position among the grouped lines, so allocation and review keep the printed order. */
  readonly lineIndex: number;
  readonly certainty: Certainty;
}

export interface ReceiptDraft {
  readonly merchant: ReceiptField<string>;
  /** `YYYY-MM-DD` as printed (no time zone shift). */
  readonly date: ReceiptField<string>;
  /** `HH:mm` as printed. */
  readonly time: ReceiptField<string>;
  /** ISO currency code. */
  readonly currency: ReceiptField<string>;
  readonly subtotal: ReceiptField<number>;
  readonly taxes: readonly ReceiptCharge[];
  readonly fees: readonly ReceiptCharge[];
  readonly discounts: readonly ReceiptCharge[];
  readonly total: ReceiptField<number>;
  readonly items: readonly ReceiptItem[];
  /** Lines that carry an amount but were not recognised as anything above. */
  readonly unparsedLineCount: number;
}

export interface ParseReceiptOptions {
  /** ISO 3166-1 alpha-2 profile region, which sets decimal mark and date order. */
  readonly region: string;
  readonly profileCurrency: string;
}

/** The recorded fields of a synthetic receipt (Story 10.1 ground truth) that `scoreReceiptFields` compares against. */
export interface ReceiptGroundTruth {
  readonly merchant: string;
  readonly date: string;
  readonly totalMinor: number;
}
