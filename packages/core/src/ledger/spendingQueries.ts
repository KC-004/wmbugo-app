import type { Querier } from '../planning/budgets';

/**
 * The ledger's filtered spending and income queries (Story 7.1, INS-003, INS-005). The `insights` module composes these and
 * never reads a ledger table itself. Only confirmed, live entries count; transfers (card bill payments and moves into
 * savings pots included) are neither spending nor income; waiting, rejected, excluded and reversed entries are never counted.
 * Dates are the entry's own `local_date`, inclusive at both ends here (the period service owns every boundary). All money is
 * integer minor units, aggregated in SQLite.
 */

/** An inclusive range of local dates. */
export interface DateRange {
  readonly start: string;
  readonly end: string;
}

export type LedgerEntryType = 'expense' | 'income' | 'refund';

/** The filters an Insights scope can carry. Waiting and rejected entries can never be included. */
export interface LedgerFilters {
  readonly accountIds?: readonly string[];
  readonly categoryIds?: readonly string[];
  /** Raw merchant descriptions to match (the caller resolves normalized merchant keys to these). `null` stands for no merchant. */
  readonly descriptions?: readonly (string | null)[];
  readonly types?: readonly LedgerEntryType[];
  readonly tags?: readonly string[];
  /** `source_record.source_kind` values. */
  readonly sources?: readonly string[];
}

export type Param = string | number;
/** A refund carries its original's merchant when it has none of its own, so a refund lands on the shop it came from. */
export const MERCHANT_SQL = "CASE WHEN TRIM(COALESCE(t.original_description, '')) <> '' THEN t.original_description ELSE (SELECT CASE WHEN TRIM(COALESCE(o.original_description, '')) <> '' THEN o.original_description END FROM \"transaction\" o WHERE o.id = t.refund_of_transaction_id) END";

export const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

/** WHERE parts (and params) for confirmed, live entries of a range under the filters. `t` is the transaction alias. */
export function entryWhere(range: DateRange, f: LedgerFilters, kinds: readonly LedgerEntryType[]): { where: string[]; params: Param[] } {
  const allowed = f.types && f.types.length > 0 ? kinds.filter((k) => f.types!.includes(k)) : kinds;
  const where = ["t.status = 'confirmed'", 't.removed_at IS NULL', 't.local_date BETWEEN ? AND ?', `t.event_type IN (${marks(Math.max(1, allowed.length))})`];
  const params: Param[] = [range.start, range.end, ...(allowed.length > 0 ? allowed : ['__none__'])];
  if (f.accountIds && f.accountIds.length > 0) {
    where.push(`EXISTS (SELECT 1 FROM posting p WHERE p.transaction_id = t.id AND p.account_id IN (${marks(f.accountIds.length)}))`);
    params.push(...f.accountIds);
  }
  if (f.descriptions && f.descriptions.length > 0) {
    const named = f.descriptions.filter((d): d is string => d !== null);
    const parts: string[] = [];
    if (named.length > 0) {
      parts.push(`${MERCHANT_SQL} IN (${marks(named.length)})`);
      params.push(...named);
    }
    if (f.descriptions.includes(null)) parts.push(`(${MERCHANT_SQL} IS NULL)`);
    where.push(`(${parts.join(' OR ')})`);
  }
  if (f.tags && f.tags.length > 0) {
    // An exact match on a tag, not a pattern: `_` and `%` in a tag are just characters.
    where.push(`EXISTS (SELECT 1 FROM json_each(t.tags_json) j WHERE j.value IN (${marks(f.tags.length)}))`);
    params.push(...f.tags);
  }
  if (f.sources && f.sources.length > 0) {
    where.push(`EXISTS (SELECT 1 FROM source_record sr WHERE sr.transaction_id = t.id AND sr.source_kind IN (${marks(f.sources.length)}))`);
    params.push(...f.sources);
  }
  return { where, params };
}

/** The split-level clause for a category filter: the category or any subcategory of it. */
export function categoryWhere(f: LedgerFilters): { where: string[]; params: Param[] } {
  if (!f.categoryIds || f.categoryIds.length === 0) return { where: [], params: [] };
  const n = f.categoryIds.length;
  return { where: [`(c.id IN (${marks(n)}) OR c.parent_id IN (${marks(n)}))`], params: [...f.categoryIds, ...f.categoryIds] };
}

const NET = "SUM(CASE WHEN t.event_type = 'expense' THEN s.amount_minor ELSE -s.amount_minor END)";
export const SPLIT_FROM = 'FROM split s JOIN "transaction" t ON t.id = s.transaction_id JOIN category c ON c.id = s.category_id';

/** True when the filters leave only income (so there is no spending to count). */
export const incomeOnly = (f: LedgerFilters): boolean => f.types !== undefined && f.types.length > 0 && !f.types.includes('expense') && !f.types.includes('refund');

export interface CategoryNetRow {
  /** The top-level category (a subcategory rolls into its parent). */
  readonly categoryId: string;
  readonly name: string;
  readonly icon: string;
  readonly colorToken: string;
  /** Expense splits minus refund splits, exact: negative when refunds are more than spending. */
  readonly netMinor: number;
}

/** Net spending per top-level category (expense splits minus refund splits, linked or categorised). */
export async function categoryNets(q: Querier, range: DateRange, f: LedgerFilters = {}): Promise<CategoryNetRow[]> {
  if (incomeOnly(f)) return [];
  const e = entryWhere(range, f, ['expense', 'refund']);
  const c = categoryWhere(f);
  const rows = await q.query(
    `SELECT COALESCE(c.parent_id, c.id), COALESCE(pc.name, c.name), COALESCE(pc.icon, c.icon), COALESCE(pc.color_token, c.color_token), ${NET} ${SPLIT_FROM} LEFT JOIN category pc ON pc.id = c.parent_id WHERE ${[...e.where, ...c.where].join(' AND ')} GROUP BY 1`,
    [...e.params, ...c.params],
  );
  return rows.map((r) => ({ categoryId: String(r[0]), name: String(r[1]), icon: String(r[2]), colorToken: String(r[3]), netMinor: Number(r[4]) }));
}

/** The exact refund-net total of spending: the sum of every category net, never floored per category. */
export async function spendingNet(q: Querier, range: DateRange, f: LedgerFilters = {}): Promise<number> {
  if (incomeOnly(f)) return 0;
  const e = entryWhere(range, f, ['expense', 'refund']);
  const c = categoryWhere(f);
  const r = (await q.query(`SELECT COALESCE(${NET}, 0) ${SPLIT_FROM} WHERE ${[...e.where, ...c.where].join(' AND ')}`, [...e.params, ...c.params]))[0];
  return Number(r?.[0] ?? 0);
}

export interface DayNetRow {
  readonly date: string;
  readonly netMinor: number;
}

/** Refund-net spending per local day (days with no spending are absent). */
export async function dayNets(q: Querier, range: DateRange, f: LedgerFilters = {}): Promise<DayNetRow[]> {
  if (incomeOnly(f)) return [];
  const e = entryWhere(range, f, ['expense', 'refund']);
  const c = categoryWhere(f);
  const rows = await q.query(`SELECT t.local_date, ${NET} ${SPLIT_FROM} WHERE ${[...e.where, ...c.where].join(' AND ')} GROUP BY t.local_date ORDER BY t.local_date`, [...e.params, ...c.params]);
  return rows.map((r) => ({ date: String(r[0]), netMinor: Number(r[1]) }));
}

/** Confirmed income in a range (income entries only; transfers are never income). */
export async function incomeNet(q: Querier, range: DateRange, f: LedgerFilters = {}): Promise<number> {
  if (f.types && f.types.length > 0 && !f.types.includes('income')) return 0;
  const e = entryWhere(range, f, ['income']);
  const where = [...e.where];
  const params = [...e.params];
  if (f.categoryIds && f.categoryIds.length > 0) {
    where.push(`EXISTS (SELECT 1 FROM split s JOIN category c ON c.id = s.category_id WHERE s.transaction_id = t.id AND (c.id IN (${marks(f.categoryIds.length)}) OR c.parent_id IN (${marks(f.categoryIds.length)})))`);
    params.push(...f.categoryIds, ...f.categoryIds);
  }
  const r = (await q.query(`SELECT COALESCE(SUM(t.amount_minor), 0) FROM "transaction" t WHERE ${where.join(' AND ')}`, params))[0];
  return Number(r?.[0] ?? 0);
}

/** Entries waiting for the user (`needs_review`) in a range: never counted, but screens say how many were left out. */
export async function waitingCount(q: Querier, range: DateRange): Promise<number> {
  const r = (await q.query("SELECT COUNT(*) FROM \"transaction\" t WHERE t.status = 'needs_review' AND t.removed_at IS NULL AND t.event_type IN ('expense','income','refund') AND t.local_date BETWEEN ? AND ?", [range.start, range.end]))[0];
  return Number(r?.[0] ?? 0);
}

/** The earliest local date of a confirmed, live entry, or null for an empty ledger (a rejected or deleted one does not move it). */
export async function firstEntryDate(q: Querier): Promise<string | null> {
  const r = (await q.query("SELECT MIN(local_date) FROM \"transaction\" WHERE status = 'confirmed' AND removed_at IS NULL"))[0];
  return r?.[0] === null || r?.[0] === undefined ? null : String(r[0]);
}

/** How many confirmed spending or income entries a range holds (an empty period says so instead of showing zeros). */
export async function entryCount(q: Querier, range: DateRange): Promise<number> {
  const r = (await q.query("SELECT COUNT(*) FROM \"transaction\" t WHERE t.status = 'confirmed' AND t.removed_at IS NULL AND t.event_type IN ('expense','income','refund') AND t.local_date BETWEEN ? AND ?", [range.start, range.end]))[0];
  return Number(r?.[0] ?? 0);
}

export interface MerchantNetRow {
  /** The raw description (null: no merchant). */
  readonly description: string | null;
  readonly netMinor: number;
  readonly entries: number;
}

/** Refund-net spending per raw merchant description; the caller folds descriptions that normalize to one merchant. */
export async function merchantNets(q: Querier, range: DateRange, f: LedgerFilters = {}): Promise<MerchantNetRow[]> {
  if (incomeOnly(f)) return [];
  const e = entryWhere(range, f, ['expense', 'refund']);
  const c = categoryWhere(f);
  const rows = await q.query(
    `SELECT ${MERCHANT_SQL}, ${NET}, COUNT(DISTINCT t.id) ${SPLIT_FROM} WHERE ${[...e.where, ...c.where].join(' AND ')} GROUP BY 1`,
    [...e.params, ...c.params],
  );
  return rows.map((r) => ({ description: r[0] === null ? null : String(r[0]), netMinor: Number(r[1]), entries: Number(r[2]) }));
}

/** The distinct merchants seen in a range, a refund counted under its original's merchant (the filter sheet lists these). */
export async function merchantDescriptions(q: Querier, range: DateRange): Promise<string[]> {
  const rows = await q.query(`SELECT DISTINCT ${MERCHANT_SQL} FROM "transaction" t WHERE t.status = 'confirmed' AND t.removed_at IS NULL AND t.event_type IN ('expense','refund','income') AND t.local_date BETWEEN ? AND ?`, [range.start, range.end]);
  return rows.filter((r) => r[0] !== null).map((r) => String(r[0]));
}

/**
 * Every merchant the ledger has ever had, for resolving a merchant filter: the spellings behind a key are not only those of the
 * period on screen, because a refund can belong to an earlier purchase and a comparison reaches into other periods.
 */
export async function allMerchantDescriptions(q: Querier): Promise<string[]> {
  const rows = await q.query(`SELECT DISTINCT ${MERCHANT_SQL} FROM "transaction" t WHERE t.status = 'confirmed' AND t.removed_at IS NULL AND t.event_type IN ('expense','refund','income')`);
  return rows.filter((r) => r[0] !== null).map((r) => String(r[0]));
}

/** Income per source and the other facets a filter sheet offers: tags and sources actually present. */
export async function filterFacets(q: Querier, range: DateRange): Promise<{ tags: string[]; sources: string[] }> {
  const tagRows = await q.query("SELECT DISTINCT tags_json FROM \"transaction\" t WHERE t.status = 'confirmed' AND t.removed_at IS NULL AND tags_json <> '[]' AND t.local_date BETWEEN ? AND ?", [range.start, range.end]);
  const tags = new Set<string>();
  for (const r of tagRows) {
    try {
      const x: unknown = JSON.parse(String(r[0]));
      if (Array.isArray(x)) for (const tag of x) if (typeof tag === 'string') tags.add(tag);
    } catch {
      /* a malformed tag list offers no tags */
    }
  }
  const sources = (await q.query("SELECT DISTINCT sr.source_kind FROM source_record sr JOIN \"transaction\" t ON t.id = sr.transaction_id WHERE t.status = 'confirmed' AND t.removed_at IS NULL AND t.local_date BETWEEN ? AND ?", [range.start, range.end])).map((r) => String(r[0]));
  return { tags: [...tags].sort(), sources };
}
