import type { ReceiptDraft, ReceiptGroundTruth } from './types';

export interface FieldScore {
  readonly total: boolean;
  /** Null when the true merchant is not written in Latin script: Phase 1 never reads such a name (OCR-007), so it is outside the rate. */
  readonly merchant: boolean | null;
  readonly date: boolean;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Compares the three fields NFR-17 measures with the recorded truth. Shared with the measurement app (Epic 14). */
export function scoreReceiptFields(draft: ReceiptDraft, truth: ReceiptGroundTruth): FieldScore {
  const latin = /\p{Script=Latin}/u.test(truth.merchant) && !/[^\p{Script=Latin}\p{N}\p{P}\p{Z}\p{S}]/u.test(truth.merchant);
  return {
    total: draft.total.value === truth.totalMinor,
    merchant: latin ? draft.merchant.value !== null && norm(draft.merchant.value) === norm(truth.merchant) : null,
    date: draft.date.value === truth.date,
  };
}
