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
  AttachReceipt,
  localToInstant,
  previewReceiptMatches,
  receiptMatchParams,
  RECEIPT_MATCH_SQL,
  SaveReceipt,
  UndoAttachReceipt,
  type AttachReceiptUndo,
  type ReceiptMatch,
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
  /** `Keep separate` was chosen for a receipt that looked like a recorded entry. */
  readonly keepSeparate?: boolean;
}

export interface AttachRequest {
  readonly submissionId: string;
  readonly transactionId: string;
  readonly draft: ReceiptDraft;
  readonly itemCategories: readonly (string | null)[];
  readonly mainCategoryId: string;
  readonly itemsMode?: 'replace' | 'keep';
  readonly attachment?: { readonly attachmentId: string; readonly digest: string; readonly sizeBytes: number };
  /** Attach the photo and nothing else. */
  readonly photoOnly?: boolean;
}

export interface AttachTarget {
  readonly amountMinor: number;
  readonly accountName: string | null;
  readonly occurredAtMs: number;
  readonly localDate: string;
}

export type AttachOutcome = { ok: true; value: { undo: AttachReceiptUndo; adjustmentMinor: number } } | { ok: false; code: string };

export type SaveOutcome = { ok: true; value: { transactionId: string; result: SubmitResult } } | { ok: false; code: string };

export interface ReceiptApi {
  load(merchant: string | null): Promise<ReceiptContext | null>;
  newSubmissionId(): string;
  save(request: SaveReceiptRequest): Promise<SaveOutcome>;
  /** Undo: the entry is removed as deleted (a receipt is user-initiated, never rejected as not mine). */
  remove(transactionId: string): Promise<{ ok: boolean }>;
  /** A dry run of the matcher: recorded expenses this receipt probably is (nothing is written). */
  matches(draft: ReceiptDraft, timezoneId: string): Promise<ReceiptMatch[]>;
  /** The recorded entry a receipt is being attached to (attach mode), or null when it is gone. */
  entry(transactionId: string): Promise<AttachTarget | null>;
  /** How many receipt items an entry already has. */
  itemCount(transactionId: string): Promise<number>;
  attach(request: AttachRequest): Promise<AttachOutcome>;
  undoAttach(undo: AttachReceiptUndo): Promise<{ ok: boolean }>;
}

/** How many categories show before `More`, as on the Add sheet. */
const QUICK_COUNT = 4;

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
    const quick = rankCategories(categories, counts).map((c) => byId.get(c.id)).filter((c): c is CategoryRow => c !== undefined).slice(0, QUICK_COUNT);
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
  async save({ submissionId, draft, itemCategories, mainCategoryId, accountId, createCash, attachment, keepSeparate }) {
    const r = await getServices().writer.run(
      SaveReceipt,
      { submissionId, draft, itemCategories, mainCategoryId, accountId, ...(createCash ? { createCash: true } : {}), ...(attachment ? { attachment } : {}), ...(keepSeparate ? { keepSeparate: true } : {}) },
      'user',
    );
    return r.ok ? { ok: true, value: { transactionId: r.value.transactionId, result: r.value.result } } : r;
  },
  remove: (transactionId) => getServices().writer.run(RemoveEntry, { transactionId }, 'user'),
  async matches(draft, timezoneId) {
    const total = draft.total.value;
    const date = draft.date.value;
    if (total === null || total <= 0 || date === null) return [];
    const [h, m] = draft.time.value !== null && /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time.value) ? draft.time.value.split(':').map(Number) : [12, 0];
    const at = localToInstant(date, h!, m!, timezoneId);
    const rows = await getServices().db.query(RECEIPT_MATCH_SQL, receiptMatchParams(total, date));
    return previewReceiptMatches({ merchant: draft.merchant.value, localDate: date, occurredAtMs: at.ok ? at.value : systemClock.nowMs(), totalMinor: total }, rows);
  },
  async entry(transactionId) {
    const r = (await getServices().db.query("SELECT t.amount_minor, (SELECT a.name FROM posting p JOIN account a ON a.id = p.account_id WHERE p.transaction_id = t.id AND p.posting_kind = 'normal' LIMIT 1), t.occurred_at_utc, t.local_date FROM \"transaction\" t WHERE t.id = ? AND t.removed_at IS NULL AND t.event_type = 'expense'", [transactionId]))[0];
    return r ? { amountMinor: Number(r[0]), accountName: r[1] === null ? null : String(r[1]), occurredAtMs: Number(r[2]), localDate: String(r[3]) } : null;
  },
  async itemCount(transactionId) {
    return Number((await getServices().db.query('SELECT COUNT(*) FROM receipt_item WHERE transaction_id = ?', [transactionId]))[0]?.[0] ?? 0);
  },
  async attach(request) {
    const r = await getServices().writer.run(AttachReceipt, request, 'user');
    return r.ok ? { ok: true, value: { undo: r.value.undo, adjustmentMinor: r.value.adjustmentMinor } } : r;
  },
  undoAttach: (undo) => getServices().writer.run(UndoAttachReceipt, { undo }, 'user'),
};
