import type { Querier } from '../planning/budgets';
import { categoryWhere, entryWhere, incomeOnly, marks, SPLIT_FROM, type DateRange, type LedgerEntryType, type LedgerFilters, type Param } from './spendingQueries';

/**
 * The entries behind an Insights figure (Story 7.3, PRD 8.9): each row carries the part of the entry that counts, so adding
 * them up the refund-net way gives the figure exactly. Only confirmed, live expense, refund and income entries appear.
 */
export interface SegmentEntry {
  readonly id: string;
  readonly localDate: string;
  readonly type: LedgerEntryType;
  readonly merchant: string | null;
  readonly categoryName: string | null;
  readonly categoryIcon: string | null;
  readonly categoryColor: string | null;
  readonly accountName: string | null;
  /** What this row counts for: the matching split portion for spending, the entry amount for income. Never negative. */
  readonly amountMinor: number;
}

const ACCOUNT_NAME = "(SELECT a.name FROM posting p JOIN account a ON a.id = p.account_id WHERE p.transaction_id = t.id AND p.posting_kind = 'normal' ORDER BY p.signed_amount_minor LIMIT 1)";
const MERCHANT = "CASE WHEN TRIM(COALESCE(t.original_description, '')) = '' THEN NULL ELSE t.original_description END";
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** One row per entry per top-level category, newest first. */
export async function spendingEntries(q: Querier, range: DateRange, f: LedgerFilters = {}): Promise<SegmentEntry[]> {
  if (incomeOnly(f)) return [];
  const e = entryWhere(range, f, ['expense', 'refund']);
  const c = categoryWhere(f);
  const rows = await q.query(
    `SELECT t.id, t.local_date, t.event_type, ${MERCHANT}, COALESCE(pc.name, c.name), COALESCE(pc.icon, c.icon), COALESCE(pc.color_token, c.color_token), ${ACCOUNT_NAME}, SUM(s.amount_minor) ${SPLIT_FROM} LEFT JOIN category pc ON pc.id = c.parent_id WHERE ${[...e.where, ...c.where].join(' AND ')} GROUP BY t.id, COALESCE(c.parent_id, c.id) ORDER BY t.local_date DESC, t.occurred_at_utc DESC, t.id`,
    [...e.params, ...c.params],
  );
  return rows.map((r) => ({ id: String(r[0]), localDate: String(r[1]), type: String(r[2]) as LedgerEntryType, merchant: text(r[3]), categoryName: text(r[4]), categoryIcon: text(r[5]), categoryColor: text(r[6]), accountName: text(r[7]), amountMinor: Number(r[8]) }));
}

/** The income entries behind an income figure, newest first. */
export async function incomeEntries(q: Querier, range: DateRange, f: LedgerFilters = {}): Promise<SegmentEntry[]> {
  if (f.types && f.types.length > 0 && !f.types.includes('income')) return [];
  const e = entryWhere(range, f, ['income']);
  const where = [...e.where];
  const params: Param[] = [...e.params];
  if (f.categoryIds && f.categoryIds.length > 0) {
    where.push(`EXISTS (SELECT 1 FROM split s JOIN category c ON c.id = s.category_id WHERE s.transaction_id = t.id AND (c.id IN (${marks(f.categoryIds.length)}) OR c.parent_id IN (${marks(f.categoryIds.length)})))`);
    params.push(...f.categoryIds, ...f.categoryIds);
  }
  const first = (col: string) => `(SELECT ${col} FROM split s JOIN category c ON c.id = s.category_id WHERE s.transaction_id = t.id ORDER BY s.amount_minor DESC LIMIT 1)`;
  const rows = await q.query(
    `SELECT t.id, t.local_date, ${MERCHANT}, ${first('c.name')}, ${first('c.icon')}, ${first('c.color_token')}, ${ACCOUNT_NAME}, t.amount_minor FROM "transaction" t WHERE ${where.join(' AND ')} ORDER BY t.local_date DESC, t.occurred_at_utc DESC, t.id`,
    params,
  );
  return rows.map((r) => ({ id: String(r[0]), localDate: String(r[1]), type: 'income' as const, merchant: text(r[2]), categoryName: text(r[3]), categoryIcon: text(r[4]), categoryColor: text(r[5]), accountName: text(r[6]), amountMinor: Number(r[7]) }));
}
