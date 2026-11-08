import {
  ACCOUNT_LIST_SQL,
  CATEGORY_LIST_SQL,
  CATEGORY_USE_SQL,
  getCurrency,
  LAST_ACCOUNT_FOR_CATEGORY_SQL,
  LAST_ACCOUNT_SQL,
  mapAccountRows,
  mapCategoryRows,
  RecordTransfer,
  blockTransfersAboveBalance,
  type TransferInput,
  pickDefaultAccount,
  rankCategories,
  rankIsStale,
  RecordManualEntry,
  RemoveEntry,
  type AccountRow,
  type CategoryRow,
  type CurrencyCode,
  type EntryKind,
  type ManualEntry,
} from '@wmbugo/core';
import { getServices, systemClock } from '../../adapters/startApp';

/** The sheet's three segments. */
export type AddKind = EntryKind | 'transfer';

export interface AddData {
  readonly currency: CurrencyCode;
  readonly exponent: number;
  readonly locale: string;
  readonly timezoneId: string;
  /** Every active category of this kind, in seed order (for More). */
  readonly categories: CategoryRow[];
  /** Quick chips: most used first. Fixed for the life of the open sheet. */
  readonly quick: CategoryRow[];
  readonly accounts: AccountRow[];
  /** The account to pick before any category is chosen; null when there is no account yet. */
  readonly defaultAccountId: string | null;
  /** Settings > You > Block transfers above the balance. */
  readonly blockTransfers: boolean;
}

export type RecordResult = { ok: true; value: { transactionId: string; accountId: string } } | { ok: false; code: string };

export type TransferResult = { ok: true; value: { transactionId: string; feeTransactionId: string | null } } | { ok: false; code: string };

/** What the Add sheet needs. The real one reads and writes through the ledger; tests pass a fake. */
export interface AddApi {
  load(kind: AddKind): Promise<AddData | null>;
  defaultAccountFor(categoryId: string): Promise<string | null>;
  record(entry: ManualEntry): Promise<RecordResult>;
  recordTransfer(input: TransferInput): Promise<TransferResult>;
  remove(transactionId: string): Promise<{ ok: boolean }>;
}

/** The quick-chip order is recalculated at most once a day, and only when a sheet opens. */
const rankCache = new Map<AddKind, { computedAt: number; ids: string[] }>();

export function resetRankCache(): void {
  rankCache.clear();
}

async function activeAccountIds(): Promise<string[]> {
  const rows = mapAccountRows(await getServices().db.query(ACCOUNT_LIST_SQL));
  return rows.filter((a) => a.status === 'active').map((a) => a.id);
}

export const realAddApi: AddApi = {
  async load(kind) {
    const db = getServices().db;
    const prof = (await db.query('SELECT currency_code, currency_exponent, locale, timezone_id FROM profile LIMIT 1'))[0];
    if (!prof) return null;
    const cur = getCurrency(String(prof[0]));
    if (!cur.ok) return null;

    const categories = mapCategoryRows(await db.query(CATEGORY_LIST_SQL)).filter((c) => c.kind === (kind === 'income' ? 'income' : 'expense'));
    const now = systemClock.nowMs();
    let cached = rankCache.get(kind);
    if (!cached || rankIsStale(cached.computedAt, now)) {
      const counts = new Map((await db.query(CATEGORY_USE_SQL)).map((r) => [String(r[0]), Number(r[1])] as const));
      cached = { computedAt: now, ids: rankCategories(categories, counts).map((c) => c.id) };
      rankCache.set(kind, cached);
    }
    const byId = new Map(categories.map((c) => [c.id, c]));
    const quick = cached.ids.map((id) => byId.get(id)).filter((c): c is CategoryRow => c !== undefined);

    const accounts = mapAccountRows(await db.query(ACCOUNT_LIST_SQL)).filter((a) => a.status === 'active');
    const lastAny = ((await db.query(LAST_ACCOUNT_SQL))[0]?.[0] as string | undefined) ?? null;
    return {
      currency: cur.value.code,
      exponent: Number(prof[1]),
      locale: String(prof[2]),
      timezoneId: String(prof[3]),
      categories,
      quick,
      accounts,
      defaultAccountId: pickDefaultAccount(accounts.map((a) => a.id), null, lastAny),
      blockTransfers: await blockTransfersAboveBalance({ query: (q, params) => db.query(q, params) }),
    };
  },
  async defaultAccountFor(categoryId) {
    const db = getServices().db;
    const ids = await activeAccountIds();
    const forCat = ((await db.query(LAST_ACCOUNT_FOR_CATEGORY_SQL, [categoryId]))[0]?.[0] as string | undefined) ?? null;
    const lastAny = ((await db.query(LAST_ACCOUNT_SQL))[0]?.[0] as string | undefined) ?? null;
    return pickDefaultAccount(ids, forCat, lastAny);
  },
  record: (entry) => getServices().writer.run(RecordManualEntry, entry, 'user'),
  recordTransfer: (input) => getServices().writer.run(RecordTransfer, input, 'user'),
  remove: (transactionId) => getServices().writer.run(RemoveEntry, { transactionId }, 'user'),
};
