import { assetTotal, type AccountRow } from './accounts';

/** Confirmed expenses in a local-date range (inclusive), not removed. Params: start, end. */
export const SPENT_EXPENSES_SQL =
  "SELECT COALESCE(SUM(amount_minor), 0) FROM \"transaction\" WHERE event_type = 'expense' AND status = 'confirmed' AND removed_at IS NULL AND local_date BETWEEN ? AND ?";
/** Confirmed refunds in the range (they reduce spending). Params: start, end. */
export const SPENT_REFUNDS_SQL =
  "SELECT COALESCE(SUM(amount_minor), 0) FROM \"transaction\" WHERE event_type = 'refund' AND status = 'confirmed' AND removed_at IS NULL AND local_date BETWEEN ? AND ?";

/** Spent = confirmed expenses minus refunds, never below zero. */
export function spentMinor(expensesMinor: number, refundsMinor: number): number {
  return Math.max(0, expensesMinor - refundsMinor);
}

export interface HomeAccounts {
  readonly hasAccounts: boolean;
  /** Sum of included asset accounts with a balance; null when none has one. */
  readonly inAccountsMinor: number | null;
  readonly notSetCount: number;
  /** What is owed on cards with a known balance; null when there is no card with a balance. */
  readonly cardDuesMinor: number | null;
}

/** "In accounts" and "Card dues" side by side, never summed; an unknown balance is never shown as zero. */
export function homeAccounts(accounts: readonly AccountRow[]): HomeAccounts {
  const active = accounts.filter((a) => a.status === 'active');
  const assets = assetTotal(active);
  const cards = active.filter((a) => a.type === 'card' && !a.balanceNotSet);
  return {
    hasAccounts: active.length > 0,
    inAccountsMinor: assets.accountsCounted > 0 ? assets.minor : null,
    notSetCount: assets.accountsNotSet,
    cardDuesMinor: cards.length > 0 ? cards.reduce((n, c) => n - c.postingsMinor, 0) : null,
  };
}

export type ActivityKind = 'expense' | 'income' | 'transfer' | 'refund';

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
}

/** Newest first. Transfers have two postings, so rows can repeat; `mapActivityRows` keeps the first. */
export const ACTIVITY_SQL =
  "SELECT t.id, t.event_type, t.amount_minor, t.local_date, t.original_description, c.name, c.icon, c.color_token, a.name FROM \"transaction\" t LEFT JOIN split s ON s.transaction_id = t.id LEFT JOIN category c ON c.id = s.category_id LEFT JOIN posting p ON p.transaction_id = t.id LEFT JOIN account a ON a.id = p.account_id WHERE t.removed_at IS NULL AND t.status = 'confirmed' AND t.event_type IN ('expense','income','transfer','refund') ORDER BY t.local_date DESC, t.occurred_at_utc DESC, t.id DESC, p.signed_amount_minor ASC LIMIT 500";

export function mapActivityRows(rows: readonly (readonly unknown[])[]): ActivityRow[] {
  const seen = new Set<string>();
  const out: ActivityRow[] = [];
  for (const r of rows) {
    const id = String(r[0]);
    if (seen.has(id)) continue;
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
    if (r.kind === 'expense') day.expenses += r.amountMinor;
    else if (r.kind === 'refund') day.refunds += r.amountMinor;
  }
  return days.map((d) => ({ localDate: d.localDate, spentMinor: spentMinor(d.expenses, d.refunds), rows: d.rows }));
}

