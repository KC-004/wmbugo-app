import type { ActivityRow } from './readModels';

/** One account's timeline row: the Activity row, plus the signed effect on this account. */
export interface TimelineRow extends ActivityRow {
  /** Signed posting on this account: negative leaves it, positive enters it. */
  readonly signedMinor: number;
}

const FILTER = "t2.removed_at IS NULL AND t2.status IN ('confirmed','reversed') AND t2.event_type IN ('expense','income','transfer','refund','adjustment','reversal')";

/**
 * The newest entries that touched one account, one page (Story 2.3). Params: account id, account id, the number of
 * entries (ask for one more than you show). A transfer is one row: its other side is `other` (the account on the
 * far end). The opening balance is not in this list; it is the footer row, read from the account.
 */
export const ACCOUNT_TIMELINE_SQL =
  'SELECT t.id, t.event_type, t.amount_minor, t.local_date, t.original_description, c.name, c.icon, c.color_token, ' +
  '(SELECT a2.name FROM posting p2 JOIN account a2 ON a2.id = p2.account_id WHERE p2.transaction_id = t.id AND p2.account_id <> p.account_id ORDER BY p2.id LIMIT 1), ' +
  "(p.posting_kind = 'normal' AND a.opening_effective_at IS NOT NULL AND t.occurred_at_utc < a.opening_effective_at), p.signed_amount_minor " +
  'FROM posting p JOIN "transaction" t ON t.id = p.transaction_id JOIN account a ON a.id = p.account_id ' +
  'LEFT JOIN split s ON s.transaction_id = t.id LEFT JOIN category c ON c.id = s.category_id ' +
  'WHERE p.account_id = ? AND t.id IN (SELECT t2.id FROM posting p3 JOIN "transaction" t2 ON t2.id = p3.transaction_id WHERE p3.account_id = ? AND ' +
  FILTER +
  ' ORDER BY t2.local_date DESC, t2.occurred_at_utc DESC, t2.id DESC LIMIT ?) ' +
  'ORDER BY t.local_date DESC, t.occurred_at_utc DESC, t.id DESC';

export function mapTimelineRows(rows: readonly (readonly unknown[])[]): TimelineRow[] {
  const seen = new Set<string>();
  const out: TimelineRow[] = [];
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  for (const r of rows) {
    const id = String(r[0]);
    if (seen.has(id)) continue; // a split entry joins once per split; the first is enough here
    seen.add(id);
    out.push({
      id,
      kind: String(r[1]) as TimelineRow['kind'],
      amountMinor: Number(r[2]),
      localDate: String(r[3]),
      merchant: s(r[4]),
      categoryName: s(r[5]),
      categoryIcon: s(r[6]),
      categoryColor: s(r[7]),
      accountName: s(r[8]),
      beforeTracking: Number(r[9]) === 1,
      signedMinor: Number(r[10]),
    });
  }
  return out;
}

/** The account's starting balance (opening) and when tracking began; null when its balance was never set. */
export const ACCOUNT_START_SQL = 'SELECT opening_minor, opening_effective_at FROM account WHERE id = ? AND balance_not_set = 0 AND opening_effective_at IS NOT NULL';
