import type { AccountRow } from './accounts';
import { overviewTotals } from './balances';

/** Confirmed expenses in a local-date range (inclusive), not removed. Params: start, end. */
export const SPENT_EXPENSES_SQL =
  "SELECT COALESCE(SUM(amount_minor), 0) FROM \"transaction\" WHERE event_type = 'expense' AND status = 'confirmed' AND removed_at IS NULL AND local_date BETWEEN ? AND ?";
/** Confirmed refunds in the range (they reduce spending). Params: start, end. */
export const SPENT_REFUNDS_SQL =
  "SELECT COALESCE(SUM(amount_minor), 0) FROM \"transaction\" WHERE event_type = 'refund' AND status = 'confirmed' AND removed_at IS NULL AND local_date BETWEEN ? AND ?";

/** Confirmed income in a local-date range (inclusive), not removed. Transfers are never income. Params: start, end. */
export const INCOME_SQL =
  "SELECT COALESCE(SUM(amount_minor), 0) FROM \"transaction\" WHERE event_type = 'income' AND status = 'confirmed' AND removed_at IS NULL AND local_date BETWEEN ? AND ?";

/** Spent = confirmed expenses minus refunds, never below zero. */
export function spentMinor(expensesMinor: number, refundsMinor: number): number {
  return Math.max(0, expensesMinor - refundsMinor);
}

export interface HomeAccounts {
  readonly hasAccounts: boolean;
  /** Sum of included asset accounts with a balance; null when none has one. */
  readonly inAccountsMinor: number | null;
  /** Asset accounts with no balance set. */
  readonly notSetCount: number;
  /** What is owed on cards with a known balance; null when no card has one. */
  readonly cardDuesMinor: number | null;
  /** Cards with no balance set. */
  readonly notSetCards: number;
}

/** "In accounts" and "Card dues" side by side, from the one overview query (never summed here). */
export function homeAccounts(accounts: readonly AccountRow[]): HomeAccounts {
  const t = overviewTotals(accounts);
  return {
    hasAccounts: accounts.some((a) => a.status === 'active'),
    inAccountsMinor: t.inAccountsMinor,
    notSetCount: t.notSetAssets,
    cardDuesMinor: t.cardDuesMinor,
    notSetCards: t.notSetCards,
  };
}

export type ActivityKind = 'expense' | 'income' | 'transfer' | 'refund' | 'adjustment';

export interface ActivityRow {
  readonly id: string;
  readonly kind: ActivityKind;
  readonly amountMinor: number;
  readonly localDate: string;
  readonly merchant: string | null;
  readonly categoryName: string | null;
  readonly categoryIcon: string | null;
  readonly categoryColor: string | null;
  readonly accountName: string | null;
  /** Dated before its account's tracking start: it never changed that balance (FIN-016). Derived on read. */
  readonly beforeTracking?: boolean;
  /** The signed posting on the row's account. Set for balance adjustments, which read "up" or "down". */
  readonly signedMinor?: number;
  /** Held back as a possible duplicate: shown to be resolved, never counted in Spent or any total. */
  readonly held?: boolean;
  /** Came from a capture source, not typed by the user: it is rejected (Reject · Not mine), never deleted. */
  readonly captured?: boolean;
}

/** How many entries Activity loads at a time. */
export const ACTIVITY_PAGE_SIZE = 100;

// Confirmed entries, plus an entry held back as a possible duplicate (it shows so it can be resolved, but counts nowhere).
const ACTIVITY_FILTER =
  "t2.removed_at IS NULL AND (t2.status = 'confirmed' OR (t2.status = 'needs_review' AND EXISTS (SELECT 1 FROM review_candidate rc WHERE rc.transaction_id = t2.id AND rc.reason = 'duplicate' AND rc.status = 'open'))) AND t2.event_type IN ('expense','income','transfer','refund','adjustment')";

/**
 * The newest entries first, one page. Param: the number of entries (ask for one more than you show, to know
 * whether there are earlier ones). Transfers have two postings, so rows can repeat; `mapActivityRows` keeps
 * the first and joins the two account names.
 */
export const ACTIVITY_SQL =
  'SELECT t.id, t.event_type, t.amount_minor, t.local_date, t.original_description, c.name, c.icon, c.color_token, a.name, (p.posting_kind = \'normal\' AND a.opening_effective_at IS NOT NULL AND t.occurred_at_utc < a.opening_effective_at), p.signed_amount_minor, t.status, (SELECT 1 FROM source_record sr WHERE sr.transaction_id = t.id AND sr.source_kind <> \'manual\' LIMIT 1) FROM "transaction" t LEFT JOIN split s ON s.transaction_id = t.id LEFT JOIN category c ON c.id = s.category_id LEFT JOIN posting p ON p.transaction_id = t.id LEFT JOIN account a ON a.id = p.account_id WHERE t.id IN (SELECT t2.id FROM "transaction" t2 WHERE ' +
  ACTIVITY_FILTER +
  ' ORDER BY t2.local_date DESC, t2.occurred_at_utc DESC, t2.id DESC LIMIT ?) ORDER BY t.local_date DESC, t.occurred_at_utc DESC, t.id DESC, p.signed_amount_minor ASC';

/** The page to show and whether earlier entries exist (the query was asked for `limit + 1`). */
export function pageActivity(rows: readonly ActivityRow[], limit: number): { rows: ActivityRow[]; hasMore: boolean } {
  if (rows.length <= limit) return { rows: [...rows], hasMore: false };
  // The first row left out belongs to a day that may be only partly shown: leave that whole day for the next
  // page so a day's "Spent" is never under-reported. (If one day fills the page, show it as it is.)
  const cut = rows[limit]!.localDate;
  const kept = rows.slice(0, limit).filter((r) => r.localDate !== cut);
  return { rows: kept.length > 0 ? kept : rows.slice(0, limit), hasMore: true };
}

export function mapActivityRows(rows: readonly (readonly unknown[])[]): ActivityRow[] {
  const seen = new Set<string>();
  const out: ActivityRow[] = [];
  for (const r of rows) {
    const id = String(r[0]);
    if (seen.has(id)) {
      // A transfer has two postings (From first): show "From → To".
      const at = out.findIndex((o) => o.id === id);
      const prev = out[at];
      const name = r[8] === null || r[8] === undefined ? null : String(r[8]);
      if (prev && prev.kind === 'transfer' && name && prev.accountName && prev.accountName !== name && !prev.accountName.includes('→')) {
        out[at] = { ...prev, accountName: `${prev.accountName} → ${name}` };
      }
      continue;
    }
    seen.add(id);
    const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
    out.push({
      id,
      kind: String(r[1]) as ActivityKind,
      amountMinor: Number(r[2]),
      localDate: String(r[3]),
      merchant: s(r[4]),
      categoryName: s(r[5]),
      categoryIcon: s(r[6]),
      categoryColor: s(r[7]),
      accountName: s(r[8]),
      beforeTracking: String(r[1]) !== 'transfer' && String(r[1]) !== 'adjustment' && Number(r[9]) === 1,
      ...(String(r[1]) === 'adjustment' ? { signedMinor: Number(r[10]) } : {}),
      ...(String(r[11]) === 'needs_review' ? { held: true } : {}),
      ...(Number(r[12]) === 1 ? { captured: true } : {}),
    });
  }
  return out;
}

export interface ActivityDay {
  readonly localDate: string;
  /** Confirmed expenses minus refunds that day, never below zero; transfers and income are not counted. */
  readonly spentMinor: number;
  readonly rows: readonly ActivityRow[];
}

/** Groups rows (already newest first) under their local date. */
export function groupByDay(rows: readonly ActivityRow[]): ActivityDay[] {
  const days: { localDate: string; expenses: number; refunds: number; rows: ActivityRow[] }[] = [];
  for (const r of rows) {
    let day = days[days.length - 1];
    if (!day || day.localDate !== r.localDate) {
      day = { localDate: r.localDate, expenses: 0, refunds: 0, rows: [] };
      days.push(day);
    }
    day.rows.push(r);
    if (r.held) continue;
    if (r.kind === 'expense') day.expenses += r.amountMinor;
    else if (r.kind === 'refund') day.refunds += r.amountMinor;
  }
  return days.map((d) => ({ localDate: d.localDate, spentMinor: spentMinor(d.expenses, d.refunds), rows: d.rows }));
}

