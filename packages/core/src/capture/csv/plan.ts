import { daysApart, matchItem, type CaptureItem } from '../match';
import { sha256Hex } from '../../shared/sha256';
import type { CsvCandidate, CsvRowError, ValidatedRow } from './rows';

/**
 * The import plan (Story 9.3, IMP-004): before anything is written, every row gets exactly one class, with the evidence for it. Pure:
 * the ledger is read into an `ImportPlanContext` first (see `loadImportPlanContext`), and nothing here writes or reads storage.
 */
export type ImportClass =
  | 'new'
  | 'already_recorded'
  | 'possible_duplicate'
  | 'transfer_pair'
  | 'held_pair'
  | 'edge_day_review'
  | 'previously_rejected'
  | 'previously_deleted'
  | 'foreign_currency'
  | 'error';

export const IMPORT_CLASSES: readonly ImportClass[] = [
  'new',
  'already_recorded',
  'possible_duplicate',
  'transfer_pair',
  'held_pair',
  'edge_day_review',
  'previously_rejected',
  'previously_deleted',
  'foreign_currency',
  'error',
];

export interface PlannedRow {
  readonly row: number;
  readonly class: ImportClass;
  readonly candidate: CsvCandidate | null;
  /** The source fingerprint this row is committed under (null for an error row). */
  readonly fingerprint: string | null;
  /** The existing entry this row duplicates, looks like, pairs with or was removed as. */
  readonly matchId?: string;
  /** For a transfer pair inside the file: the other row. */
  readonly pairRow?: number;
  /** For a held pair: the question to ask. */
  readonly question?: string;
  readonly errors: readonly CsvRowError[];
}

export interface ImportPlan {
  readonly rows: readonly PlannedRow[];
  readonly counts: Readonly<Record<ImportClass, number>>;
}

/** What the ledger knows about a fingerprint: the entry it belongs to and whether that entry has been removed. */
export interface KnownFingerprint {
  readonly transactionId: string;
  readonly removed: 'deleted' | 'rejected' | null;
}

export interface ImportPlanContext {
  /** An id for this file (its digest): rows of one file are never matched against each other. */
  readonly fileId: string;
  readonly ownedAccountIds: ReadonlySet<string>;
  /** Existing source fingerprints that the file's rows could equal. */
  readonly fingerprints: ReadonlyMap<string, KnownFingerprint>;
  /** Existing confirmed entries around the file's dates, in the matcher's shape. */
  readonly items: readonly CaptureItem[];
  /** Entries already on a day for an account, from any source: `accountId|yyyy-mm-dd` to a count. */
  readonly dayCounts: ReadonlyMap<string, number>;
  /** A purged entry's tombstone, looked up by what a row would hash to. */
  readonly tombstone: (row: { reference: string | null; direction: 'debit' | 'credit'; eventType: string; amountMinor: number; localDate: string; merchant: string | null }) => 'deleted' | 'rejected' | null;
}

export const dayKey = (accountId: string, localDate: string): string => `${accountId}|${localDate}`;

const eventTypeOf = (c: CsvCandidate): 'expense' | 'income' => (c.direction === 'out' ? 'expense' : 'income');
const directionOf = (c: CsvCandidate): 'debit' | 'credit' => (c.direction === 'out' ? 'debit' : 'credit');
const descriptionKey = (c: CsvCandidate): string => c.description.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The source fingerprint of a CSV row (LIR-03). With a reference it is (reference, direction, event type), so the same bank row in
 * an overlapping file is the same row. Without one it is (account, date, direction, amount, normalized description, occurrence), the
 * occurrence numbering identical rows 1, 2, 3 in file order, so two identical `PRET A MANGER 3.50` rows stay two rows.
 */
export function csvFingerprint(c: CsvCandidate, occurrence: number): string {
  const ref = (c.reference ?? '').trim().toLowerCase();
  if (ref !== '') return sha256Hex(['csv', 'ref', ref, c.direction, eventTypeOf(c)].join('|'));
  return sha256Hex(['csv', 'row', c.accountId ?? '', c.localDate, c.direction, String(c.amountMinor), descriptionKey(c), String(occurrence)].join('|'));
}

/** 1 for the first identical (account, date, direction, amount, description) row in file order, 2 for the next, and so on. */
function occurrences(rows: readonly CsvCandidate[]): number[] {
  const seen = new Map<string, number>();
  return rows.map((c) => {
    const key = [c.accountId ?? '', c.localDate, c.direction, c.amountMinor, descriptionKey(c)].join('|');
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n;
  });
}

const PROGRESS_EVERY = 250;

export interface PlanOptions {
  /** Called after every 250 rows, and once at the end, with rows done and rows in all. */
  readonly onProgress?: (done: number, total: number) => void;
}

const emptyCounts = (): Record<ImportClass, number> => Object.fromEntries(IMPORT_CLASSES.map((k) => [k, 0])) as Record<ImportClass, number>;

/**
 * Classifies every row of a validated file. Rows the account column sends to `Don't import these rows` are not part of the plan.
 * The order of the rules is the order of authority: an exact fingerprint match wins over everything, including the edge-day rule.
 */
export function planCsvImport(rows: readonly ValidatedRow[], ctx: ImportPlanContext, options: PlanOptions = {}): ImportPlan {
  const planned = rows.filter((r) => !r.skipped);
  const candidates = planned.filter((r): r is ValidatedRow & { candidate: CsvCandidate } => r.candidate !== null).map((r) => r.candidate);
  const occ = new Map<number, number>();
  occurrences(candidates).forEach((n, i) => occ.set(candidates[i]!.row, n));

  // Existing entries by amount and by reference, so a row is compared with a handful of entries and not with all of them.
  const byAmount = new Map<number, CaptureItem[]>();
  const byReference = new Map<string, CaptureItem[]>();
  for (const it of ctx.items) {
    (byAmount.get(it.amountMinor) ?? byAmount.set(it.amountMinor, []).get(it.amountMinor)!).push(it);
    if (it.reference !== null) (byReference.get(it.reference) ?? byReference.set(it.reference, []).get(it.reference)!).push(it);
  }

  // The first and last dates in the file are the days it may cover only partly.
  const dates = candidates.map((c) => c.localDate).sort();
  const firstDay = dates[0];
  const lastDay = dates[dates.length - 1];

  const out: PlannedRow[] = [];
  const total = planned.length;
  planned.forEach((v, index) => {
    if (index > 0 && index % PROGRESS_EVERY === 0) options.onProgress?.(index, total);
    const c = v.candidate;
    if (c === null) {
      out.push({ row: v.row, class: 'error', candidate: null, fingerprint: null, errors: v.errors });
      return;
    }
    const fingerprint = csvFingerprint(c, occ.get(c.row)!);
    const base = { row: c.row, candidate: c, fingerprint, errors: [] as CsvRowError[] };

    // 1. The same row again (the same file, or an overlapping one): skipped, unless what it points to was removed.
    const known = ctx.fingerprints.get(fingerprint);
    if (known) {
      if (known.removed === 'deleted') return void out.push({ ...base, class: 'previously_deleted', matchId: known.transactionId });
      if (known.removed === 'rejected') return void out.push({ ...base, class: 'previously_rejected', matchId: known.transactionId });
      return void out.push({ ...base, class: 'already_recorded', matchId: known.transactionId });
    }

    // 2. Purged long ago: only a salted hash is left.
    const removed = ctx.tombstone({ reference: c.reference ?? null, direction: directionOf(c), eventType: eventTypeOf(c), amountMinor: c.amountMinor, localDate: c.localDate, merchant: c.merchant });
    if (removed) return void out.push({ ...base, class: removed === 'deleted' ? 'previously_deleted' : 'previously_rejected' });

    // 3. The matcher (Story 3.1), against entries that came from anywhere else.
    const item: CaptureItem = {
      id: `row-${c.row}`,
      reference: c.reference ?? null,
      direction: directionOf(c),
      eventType: eventTypeOf(c),
      amountMinor: c.amountMinor,
      localDate: c.localDate,
      occurredAtMs: c.instantMs ?? Date.UTC(Number(c.localDate.slice(0, 4)), Number(c.localDate.slice(5, 7)) - 1, Number(c.localDate.slice(8, 10))),
      merchant: c.merchant,
      accountId: c.accountId,
      source: 'csv',
      fileId: ctx.fileId,
      occurrence: occ.get(c.row)! - 1,
    };
    const near = [...(byAmount.get(c.amountMinor) ?? []), ...(c.reference ? (byReference.get(c.reference) ?? []) : [])];
    const outcome = matchItem(item, near, { ownedAccountIds: ctx.ownedAccountIds });
    switch (outcome.kind) {
      case 'duplicate_of':
        return void out.push({ ...base, class: 'already_recorded', matchId: outcome.id });
      case 'possible_duplicate_of':
        return void out.push({ ...base, class: 'possible_duplicate', matchId: outcome.id });
      case 'transfer_pair_with':
        return void out.push({ ...base, class: 'transfer_pair', matchId: outcome.id });
      case 'reversal_or_refund_of':
        return void out.push({ ...base, class: 'held_pair', matchId: outcome.id, question: 'Reversal, or a transfer between your accounts?' });
      case 'held_pair':
        return void out.push({ ...base, class: 'held_pair', ...(outcome.id === null ? {} : { matchId: outcome.id }), question: outcome.question });
      default:
        break; // no_match (previously_removed was handled above by the tombstone lookup)
    }

    // 4. Another currency is its own kind of review (Story 3.10): never converted.
    if (c.foreign) return void out.push({ ...base, class: 'foreign_currency' });

    // 5. The first or last day of the file, when the ledger already holds entries that day for the account.
    if ((c.localDate === firstDay || c.localDate === lastDay) && c.accountId !== null && (ctx.dayCounts.get(dayKey(c.accountId, c.localDate)) ?? 0) > 0) {
      return void out.push({ ...base, class: 'edge_day_review' });
    }
    out.push({ ...base, class: 'new' });
  });

  const final = pairWithinFile(out, ctx);
  options.onProgress?.(total, total);
  const counts = emptyCounts();
  for (const r of final) counts[r.class] += 1;
  return { rows: final, counts };
}

/**
 * Rows of one file on two different owned accounts that are equal and opposite, at most two days apart, are one transfer (IMP-002):
 * both become `transfer_pair`, pointing at each other. A row pairs once; the nearest day, then the lowest row number, wins.
 */
function pairWithinFile(rows: readonly PlannedRow[], ctx: ImportPlanContext): PlannedRow[] {
  const out = [...rows];
  const taken = new Set<number>();
  const free = (r: PlannedRow) => r.class === 'new' && r.candidate !== null && r.candidate.accountId !== null && ctx.ownedAccountIds.has(r.candidate.accountId) && !r.candidate.foreign;
  const byAmount = new Map<number, number[]>();
  out.forEach((r, i) => {
    if (free(r)) (byAmount.get(r.candidate!.amountMinor) ?? byAmount.set(r.candidate!.amountMinor, []).get(r.candidate!.amountMinor)!).push(i);
  });
  for (let i = 0; i < out.length; i++) {
    const a = out[i]!;
    if (!free(a) || taken.has(i)) continue;
    let best = -1;
    let bestGap = Infinity;
    for (const j of byAmount.get(a.candidate!.amountMinor) ?? []) {
      if (j <= i || taken.has(j)) continue;
      const b = out[j]!;
      if (b.candidate!.direction === a.candidate!.direction || b.candidate!.accountId === a.candidate!.accountId) continue;
      const gap = daysApart(a.candidate!.localDate, b.candidate!.localDate);
      if (gap <= 2 && gap < bestGap) {
        best = j;
        bestGap = gap;
      }
    }
    if (best !== -1) {
      taken.add(i);
      taken.add(best);
      out[i] = { ...a, class: 'transfer_pair', pairRow: out[best]!.row };
      out[best] = { ...out[best]!, class: 'transfer_pair', pairRow: a.row };
    }
  }
  return out;
}

