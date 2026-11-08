import type { SqlParam } from '../ports/storage';
import type { TouchedEntity, WriterContext } from '../writer/ledgerWriter';

/**
 * The Activity search index and the query behind search, filters and sort (Story 3.6, TXN-007).
 *
 * The index is an FTS5 table (`activity_search`, migration 0008) with one row per entry: merchant, note, category and
 * account names. The writer keeps it current inside the same transaction as every change (`searchIndexer`).
 */

const INDEXED_TYPES = "('expense','income','transfer','refund')";

const DOC_SQL =
  "SELECT t.id, TRIM(COALESCE(t.original_description, '') || ' ' || COALESCE(t.note, '') || ' ' || COALESCE((SELECT group_concat(c.name, ' ') FROM split s JOIN category c ON c.id = s.category_id WHERE s.transaction_id = t.id), '') || ' ' || COALESCE((SELECT group_concat(a.name, ' ') FROM posting p JOIN account a ON a.id = p.account_id WHERE p.transaction_id = t.id), '')) FROM \"transaction\" t WHERE t.id = ? AND t.event_type IN " + INDEXED_TYPES;

/** Rebuilds the index row of each transaction (a transaction that is not a searchable entry has none). */
export async function indexTransactions(ctx: Pick<WriterContext, 'query' | 'execute'>, ids: readonly string[]): Promise<void> {
  for (const id of new Set(ids)) {
    await ctx.execute('DELETE FROM activity_search WHERE tx_id = ?', [id]);
    const doc = (await ctx.query(DOC_SQL, [id]))[0];
    if (doc) await ctx.execute('INSERT INTO activity_search (tx_id, body) VALUES (?, ?)', [id, String(doc[1])]);
  }
}

/**
 * The writer's indexer: every transaction a use case touched is re-indexed; an account that was touched (renamed) has its
 * transactions re-indexed too, because the account name is part of what is searched.
 */
export async function searchIndexer(ctx: Pick<WriterContext, 'query' | 'execute'>, touched: readonly TouchedEntity[]): Promise<void> {
  const ids: string[] = touched.filter((t) => t.entityKind === 'transaction').map((t) => t.entityId);
  for (const a of touched.filter((t) => t.entityKind === 'account')) {
    for (const r of await ctx.query('SELECT DISTINCT transaction_id FROM posting WHERE account_id = ?', [a.entityId])) ids.push(String(r[0]));
  }
  if (ids.length > 0) await indexTransactions(ctx, ids);
}

export type ActivityType = 'expense' | 'income' | 'transfer' | 'refund';
export type ActivityStatusFilter = 'waiting' | 'check' | 'needs-category' | 'guessed' | 'reversed';
export type ActivitySort = 'newest' | 'oldest' | 'amount' | 'merchant';

/** Everything Activity can be narrowed or ordered by. Empty means no filter. */
export interface ActivityQuery {
  readonly search?: string;
  readonly accountIds?: readonly string[];
  readonly categoryIds?: readonly string[];
  readonly types?: readonly ActivityType[];
  readonly statuses?: readonly ActivityStatusFilter[];
  /** Local dates, inclusive. */
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly minMinor?: number;
  readonly maxMinor?: number;
  /** Include rejected captures from the last 90 days. */
  readonly showRejected?: boolean;
  readonly sort?: ActivitySort;
}

export const EMPTY_QUERY: ActivityQuery = {};
const DAY_MS = 86_400_000;
export const REJECTED_KEEP_DAYS = 90;

/** How many filters are active (a search counts for none: it has its own field). */
export function activeFilterCount(q: ActivityQuery): number {
  return (
    (q.fromDate || q.toDate ? 1 : 0) +
    (q.accountIds?.length ?? 0) +
    (q.categoryIds?.length ?? 0) +
    (q.types?.length ?? 0) +
    (q.statuses?.length ?? 0) +
    (q.minMinor !== undefined || q.maxMinor !== undefined ? 1 : 0) +
    (q.showRejected ? 1 : 0)
  );
}

export function isFiltered(q: ActivityQuery): boolean {
  return activeFilterCount(q) > 0 || (q.search ?? '').trim() !== '';
}

/** Sorted by amount or merchant, Activity is a flat list: no day headers and no Spent. */
export function isFlatSort(q: ActivityQuery): boolean {
  return q.sort === 'amount' || q.sort === 'merchant';
}

const NUMERIC = /^\d+(?:[.,]\d+)?$/;

/** The text of an FTS5 query for what was typed: each word must match, the last as a prefix. null when there is nothing to search. */
export function ftsQuery(search: string): string | null {
  const words = search.trim().split(/\s+/).map((w) => w.replace(/["']/g, '')).filter((w) => w !== '');
  if (words.length === 0) return null;
  return words.map((w, i) => `"${w}"${i === words.length - 1 ? '*' : ''}`).join(' ');
}

/** "450" or "450.5" read as an exact amount in minor units; null when it is not a plain number. */
export function amountFromSearch(search: string, exponent: number): number | null {
  const t = search.trim();
  if (!NUMERIC.test(t)) return null;
  const [whole, frac = ''] = t.replace(',', '.').split('.');
  if (frac.length > exponent) return null;
  const minor = Number(whole) * 10 ** exponent + Number(frac.padEnd(exponent, '0') || 0);
  return Number.isSafeInteger(minor) ? minor : null;
}

const STATUS_SQL: Readonly<Record<ActivityStatusFilter, string>> = {
  waiting: "(t2.status = 'needs_review' AND NOT EXISTS (SELECT 1 FROM review_candidate rc WHERE rc.transaction_id = t2.id AND rc.reason = 'duplicate' AND rc.status = 'open'))",
  check: "(t2.status = 'needs_review' AND EXISTS (SELECT 1 FROM review_candidate rc WHERE rc.transaction_id = t2.id AND rc.reason = 'duplicate' AND rc.status = 'open'))",
  'needs-category': '(t2.needs_category = 1)',
  guessed: "(t2.capture_resolution = 'auto_approved' AND t2.needs_category = 0)",
  reversed: "(t2.status = 'reversed')",
};

const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

/** The WHERE of the inner query over `"transaction" t2`, with its parameters in order. */
export function activityWhere(q: ActivityQuery, ctx: { exponent: number; nowMs: number }): { where: string; params: SqlParam[] } {
  const params: SqlParam[] = [];
  const parts: string[] = [];

  // What can be listed at all: live entries (confirmed, waiting, reversed), plus recent rejected captures on request.
  const live = "(t2.removed_at IS NULL AND t2.status IN ('confirmed','needs_review','reversed') AND t2.event_type IN ('expense','income','transfer','refund','adjustment'))";
  if (q.showRejected) {
    parts.push(`(${live} OR (t2.status = 'excluded' AND t2.capture_resolution = 'rejected' AND t2.removed_at >= ? AND t2.event_type IN ('expense','income','transfer','refund')))`);
    params.push(ctx.nowMs - REJECTED_KEEP_DAYS * DAY_MS);
  } else parts.push(live);

  const search = (q.search ?? '').trim();
  if (search !== '') {
    const fts = ftsQuery(search);
    const amount = amountFromSearch(search, ctx.exponent);
    const textMatch = 't2.id IN (SELECT tx_id FROM activity_search WHERE activity_search MATCH ?)';
    if (amount !== null && fts) {
      parts.push(`(t2.amount_minor = ? OR ${textMatch})`);
      params.push(amount, fts);
    } else if (fts) {
      parts.push(textMatch);
      params.push(fts);
    }
  }
  if (q.fromDate) {
    parts.push('t2.local_date >= ?');
    params.push(q.fromDate);
  }
  if (q.toDate) {
    parts.push('t2.local_date <= ?');
    params.push(q.toDate);
  }
  if (q.accountIds?.length) {
    parts.push(`EXISTS (SELECT 1 FROM posting pf WHERE pf.transaction_id = t2.id AND pf.account_id IN (${marks(q.accountIds.length)}))`);
    params.push(...q.accountIds);
  }
  if (q.categoryIds?.length) {
    parts.push(`EXISTS (SELECT 1 FROM split sf WHERE sf.transaction_id = t2.id AND sf.category_id IN (${marks(q.categoryIds.length)}))`);
    params.push(...q.categoryIds);
  }
  if (q.types?.length) {
    parts.push(`t2.event_type IN (${marks(q.types.length)})`);
    params.push(...q.types);
  }
  if (q.statuses?.length) parts.push(`(${q.statuses.map((s) => STATUS_SQL[s]).join(' OR ')})`);
  if (q.minMinor !== undefined) {
    parts.push('t2.amount_minor >= ?');
    params.push(q.minMinor);
  }
  if (q.maxMinor !== undefined) {
    parts.push('t2.amount_minor <= ?');
    params.push(q.maxMinor);
  }
  return { where: parts.join(' AND '), params };
}

const ORDER: Readonly<Record<ActivitySort, { inner: string; outer: string }>> = {
  newest: { inner: 't2.local_date DESC, t2.occurred_at_utc DESC, t2.id DESC', outer: 't.local_date DESC, t.occurred_at_utc DESC, t.id DESC' },
  oldest: { inner: 't2.local_date ASC, t2.occurred_at_utc ASC, t2.id ASC', outer: 't.local_date ASC, t.occurred_at_utc ASC, t.id ASC' },
  amount: { inner: 't2.amount_minor DESC, t2.local_date DESC, t2.id DESC', outer: 't.amount_minor DESC, t.local_date DESC, t.id DESC' },
  merchant: {
    inner: "LOWER(COALESCE(t2.original_description, '~')) ASC, t2.local_date DESC, t2.id DESC",
    outer: "LOWER(COALESCE(t.original_description, '~')) ASC, t.local_date DESC, t.id DESC",
  },
};

/**
 * One page of Activity for a query: the columns `mapActivityRows` reads, plus the amount that matches a category filter.
 * Ask for `limit + 1` to know whether there are earlier entries. A category filter makes `matchedMinor` the sum of the
 * matching splits only, so a day's Spent counts just those.
 */
export function activityQuery(q: ActivityQuery, limit: number, ctx: { exponent: number; nowMs: number }): { sql: string; params: SqlParam[] } {
  const { where, params: whereParams } = activityWhere(q, ctx);
  const cats = q.categoryIds?.length ?? 0;
  const matched = cats > 0 ? `(SELECT SUM(sm.amount_minor) FROM split sm WHERE sm.transaction_id = t.id AND sm.category_id IN (${marks(cats)}))` : 'NULL';
  const order = ORDER[q.sort ?? 'newest'];
  const sql =
    'SELECT t.id, t.event_type, t.amount_minor, t.local_date, t.original_description, c.name, c.icon, c.color_token, a.name, (p.posting_kind = \'normal\' AND a.opening_effective_at IS NOT NULL AND t.occurred_at_utc < a.opening_effective_at), p.signed_amount_minor, t.status, (SELECT 1 FROM source_record sr WHERE sr.transaction_id = t.id AND sr.source_kind <> \'manual\' LIMIT 1), t.needs_category, t.capture_resolution, t.foreign_currency, t.foreign_amount_minor, (SELECT 1 FROM review_candidate rc WHERE rc.transaction_id = t.id AND rc.reason = \'duplicate\' AND rc.status = \'open\' LIMIT 1), ' +
    matched +
    ' FROM "transaction" t LEFT JOIN split s ON s.transaction_id = t.id LEFT JOIN category c ON c.id = s.category_id LEFT JOIN posting p ON p.transaction_id = t.id LEFT JOIN account a ON a.id = p.account_id WHERE t.id IN (SELECT t2.id FROM "transaction" t2 WHERE ' +
    where +
    ` ORDER BY ${order.inner} LIMIT ?) ORDER BY ${order.outer}, p.signed_amount_minor ASC`;
  return { sql, params: [...(cats > 0 ? q.categoryIds! : []), ...whereParams, limit] };
}

/** How many entries match (the "Show N results" button). */
export function activityCountQuery(q: ActivityQuery, ctx: { exponent: number; nowMs: number }): { sql: string; params: SqlParam[] } {
  const { where, params } = activityWhere(q, ctx);
  return { sql: `SELECT COUNT(*) FROM "transaction" t2 WHERE ${where}`, params };
}
