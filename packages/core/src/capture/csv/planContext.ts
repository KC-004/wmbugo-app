import { duplicateFingerprint, tombstoneHash } from '../../ledger/purge';
import type { Querier } from '../../planning/budgets';
import type { CaptureItem } from '../match';
import { csvFingerprint, dayKey, type ImportPlanContext, type KnownFingerprint } from './plan';
import type { CsvCandidate, ValidatedRow } from './rows';

/**
 * Reads what the plan needs from the ledger (Story 9.3): read-only queries, a few of them, never one per row. The plan itself is then
 * pure. Fingerprints are looked up in chunks, because a 5,000-row file has 5,000 of them.
 */
const CHUNK = 400;

const addDays = (date: string, n: number): string => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + n)).toISOString().slice(0, 10);

/** The fingerprints the file's rows would be committed under, numbering identical rows in file order. */
export function fingerprintsOf(rows: readonly ValidatedRow[]): Map<number, string> {
  const out = new Map<number, string>();
  const seen = new Map<string, number>();
  for (const v of rows) {
    const c = v.candidate;
    if (!c || v.skipped) continue;
    const key = [c.accountId ?? '', c.localDate, c.direction, c.amountMinor, c.description.trim().toLowerCase().replace(/\s+/g, ' ')].join('|');
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    out.set(c.row, csvFingerprint(c, n));
  }
  return out;
}

export async function loadImportPlanContext(db: Querier, rows: readonly ValidatedRow[], fileId: string): Promise<ImportPlanContext> {
  const candidates = rows.filter((r): r is ValidatedRow & { candidate: CsvCandidate } => r.candidate !== null && !r.skipped).map((r) => r.candidate);

  const owned = new Set((await db.query("SELECT id FROM account WHERE status = 'active'")).map((r) => String(r[0])));

  // Fingerprints already in the ledger, and whether the entry they belong to was removed.
  const fingerprints = new Map<string, KnownFingerprint>();
  const wanted = [...new Set(fingerprintsOf(rows).values())];
  for (let i = 0; i < wanted.length; i += CHUNK) {
    const part = wanted.slice(i, i + CHUNK);
    const found = await db.query(
      `SELECT sr.fingerprint, sr.transaction_id, t.removal_kind FROM source_record sr JOIN "transaction" t ON t.id = sr.transaction_id WHERE sr.fingerprint IN (${part.map(() => '?').join(',')})`,
      part,
    );
    for (const r of found) {
      const kind = r[2] === null || r[2] === undefined ? null : String(r[2]);
      fingerprints.set(String(r[0]), { transactionId: String(r[1]), removed: kind === null ? null : kind === 'deleted' ? 'deleted' : 'rejected' });
    }
  }

  // Confirmed entries around the file's dates, for the matcher.
  const dates = candidates.map((c) => c.localDate).sort();
  const items: CaptureItem[] = [];
  const dayCounts = new Map<string, number>();
  if (dates.length > 0) {
    const from = addDays(dates[0]!, -3);
    const to = addDays(dates[dates.length - 1]!, 3);
    const found = await db.query(
      `SELECT t.id, t.event_type, t.amount_minor, t.local_date, t.occurred_at_utc, t.original_description, p.account_id,
              COALESCE((SELECT sr.source_kind FROM source_record sr WHERE sr.transaction_id = t.id ORDER BY sr.created_at LIMIT 1), 'manual'),
              (SELECT sr.reference FROM source_record sr WHERE sr.transaction_id = t.id ORDER BY sr.created_at LIMIT 1)
       FROM "transaction" t JOIN posting p ON p.transaction_id = t.id AND p.posting_kind = 'normal'
       WHERE t.status = 'confirmed' AND t.removed_at IS NULL AND t.event_type IN ('expense','income') AND t.local_date BETWEEN ? AND ?`,
      [from, to],
    );
    for (const r of found) {
      items.push({
        id: String(r[0]),
        reference: r[8] === null || r[8] === undefined ? null : String(r[8]),
        direction: String(r[1]) === 'income' ? 'credit' : 'debit',
        eventType: String(r[1]) as 'expense' | 'income',
        amountMinor: Number(r[2]),
        localDate: String(r[3]),
        occurredAtMs: Number(r[4]),
        merchant: r[5] === null ? null : String(r[5]),
        accountId: String(r[6]),
        source: String(r[7]) as CaptureItem['source'],
      });
    }
    // Entries on the first and last day, from any source and in any state but removed: that is what a partly covered day is about.
    const edges = [...new Set([dates[0]!, dates[dates.length - 1]!])];
    const counted = await db.query(
      `SELECT p.account_id, t.local_date, COUNT(DISTINCT t.id) FROM "transaction" t JOIN posting p ON p.transaction_id = t.id AND p.posting_kind = 'normal'
       WHERE t.removed_at IS NULL AND t.status IN ('confirmed','needs_review') AND t.local_date IN (${edges.map(() => '?').join(',')}) GROUP BY p.account_id, t.local_date`,
      edges,
    );
    for (const r of counted) dayCounts.set(dayKey(String(r[0]), String(r[1])), Number(r[2]));
  }

  // Tombstones: only a salted hash of each purged entry's fingerprint is kept.
  const salt = (await db.query("SELECT value_json FROM settings WHERE key = 'tombstone_salt'"))[0];
  const hashes = new Map<string, 'deleted' | 'rejected'>();
  if (salt) for (const r of await db.query('SELECT fingerprint_hash, outcome FROM tombstone ORDER BY purged_at')) hashes.set(String(r[0]), String(r[1]) as 'deleted' | 'rejected');
  const saltValue = salt ? (JSON.parse(String(salt[0])) as string) : null;

  return {
    fileId,
    ownedAccountIds: owned,
    fingerprints,
    items,
    dayCounts,
    tombstone: (p) => (saltValue === null || hashes.size === 0 ? null : (hashes.get(tombstoneHash(saltValue, duplicateFingerprint(p))) ?? null)),
  };
}

