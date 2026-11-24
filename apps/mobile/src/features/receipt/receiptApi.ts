import {
  ACCOUNT_LIST_SQL,
  categoryFits,
  CATEGORY_LIST_SQL,
  CATEGORY_USE_SQL,
  mapAccountRows,
  mapCategoryRows,
  normalizeMerchant,
  rankCategories,
  RemoveEntry,
  SaveReceipt,
  toLocalDate,
  UNCATEGORISED_ID,
  type AccountRow,
  type CategoryRow,
  type CurrencyCode,
  type ReceiptDraft,
  type SubmitResult,
} from '@wmbugo/core';
import { getServices, systemClock } from '../../adapters/startApp';
import { readProfile } from '../../adapters/readProfile';

/** What the review needs around a draft: the profile, the accounts and categories, and the defaults for this shop. */
export interface ReceiptContext {
  readonly currency: CurrencyCode;
  readonly exponent: number;
  readonly locale: string;
  readonly timezoneId: string;
  /** Today in the profile timezone (`YYYY-MM-DD`). */
  readonly todayLocal: string;
  readonly accounts: AccountRow[];
  /** Every active expense category. */
  readonly categories: CategoryRow[];
  /** Quick chips, most used first. */
  readonly quick: CategoryRow[];
  /** Same shop's last account, else the Cash account; null when neither exists (Cash is then created in the same save). */
  readonly defaultAccountId: string | null;
  /** Same shop's last category, else Uncategorised. */
  readonly defaultCategoryId: string;
  readonly cashAccountId: string | null;
}

export interface SaveReceiptRequest {
  readonly submissionId: string;
  readonly draft: ReceiptDraft;
  /** The category the person chose for each item, or null while it follows the main category. */
  readonly itemCategories: readonly (string | null)[];
  readonly mainCategoryId: string;
  readonly accountId: string | null;
  readonly createCash: boolean;
  readonly attachment?: { readonly attachmentId: string; readonly digest: string; readonly sizeBytes: number };
}

export type SaveOutcome = { ok: true; value: { transactionId: string; result: SubmitResult } } | { ok: false; code: string };

export interface ReceiptApi {
  load(merchant: string | null): Promise<ReceiptContext | null>;
  newSubmissionId(): string;
  save(request: SaveReceiptRequest): Promise<SaveOutcome>;
  /** Undo: the entry is removed as deleted (a receipt is user-initiated, never rejected as not mine). */
  remove(transactionId: string): Promise<{ ok: boolean }>;
}

/** The last confirmed expenses with the account and the biggest category of each, newest first. */
const SHOP_HISTORY_SQL = `SELECT t.original_description, p.account_id,
  (SELECT s.category_id FROM split s WHERE s.transaction_id = t.id ORDER BY s.amount_minor DESC LIMIT 1)
  FROM "transaction" t JOIN posting p ON p.transaction_id = t.id AND p.posting_kind = 'normal'
  WHERE t.event_type = 'expense' AND t.status = 'confirmed' AND t.removed_at IS NULL AND t.original_description IS NOT NULL
  ORDER BY t.occurred_at_utc DESC LIMIT 300`;

export const realReceiptApi: ReceiptApi = {
  async load(merchant) {
    const db = getServices().db;
    const prof = await readProfile(db);
    if (!prof) return null;
    const categories = mapCategoryRows(await db.query(CATEGORY_LIST_SQL)).filter((c) => categoryFits(c.kind, 'expense'));
    const counts = new Map((await db.query(CATEGORY_USE_SQL)).map((r) => [String(r[0]), Number(r[1])] as const));
    const byId = new Map(categories.map((c) => [c.id, c]));
    const quick = rankCategories(categories, counts).map((c) => byId.get(c.id)).filter((c): c is CategoryRow => c !== undefined);
    const accounts = mapAccountRows(await db.query(ACCOUNT_LIST_SQL)).filter((a) => a.status === 'active');
    const cash = accounts.find((a) => a.type === 'cash') ?? null;

    let accountId: string | null = null;
    let categoryId: string | null = null;
    const key = normalizeMerchant(merchant);
    if (key !== '') {
      for (const r of await db.query(SHOP_HISTORY_SQL)) {
        if (normalizeMerchant(String(r[0])) !== key) continue;
        accountId = String(r[1]);
        categoryId = r[2] === null || r[2] === undefined ? null : String(r[2]);
        break;
      }
    }
    if (accountId !== null && !accounts.some((a) => a.id === accountId)) accountId = null;
    if (categoryId !== null && !categories.some((c) => c.id === categoryId)) categoryId = null;
    const today = toLocalDate(systemClock.nowMs(), prof.timezoneId);
    return {
      currency: prof.currency,
      exponent: prof.exponent,
      locale: prof.locale,
      timezoneId: prof.timezoneId,
      todayLocal: today.ok ? today.value : new Date(systemClock.nowMs()).toISOString().slice(0, 10),
      accounts,
      categories,
      quick,
      defaultAccountId: accountId ?? cash?.id ?? null,
      defaultCategoryId: categoryId ?? UNCATEGORISED_ID,
      cashAccountId: cash?.id ?? null,
    };
  },
  newSubmissionId: () => getServices().newId(),
  async save({ submissionId, draft, itemCategories, mainCategoryId, accountId, createCash, attachment }) {
    const r = await getServices().writer.run(
      SaveReceipt,
      { submissionId, draft, itemCategories, mainCategoryId, accountId, ...(createCash ? { createCash: true } : {}), ...(attachment ? { attachment } : {}) },
      'user',
    );
    return r.ok ? { ok: true, value: { transactionId: r.value.transactionId, result: r.value.result } } : r;
  },
  remove: (transactionId) => getServices().writer.run(RemoveEntry, { transactionId }, 'user'),
};
