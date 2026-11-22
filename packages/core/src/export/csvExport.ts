import type { ByteSink } from '../backup/writer';
import { utf8Encode } from '../backup/format';
import type { Querier } from '../planning/budgets';
import { addDays, isLocalDate, periodFor, previousPeriod, type PeriodProfile } from '../profile/period';
import { localMinutesOfDay } from '../shared/clock';
import { csvRow } from '../shared/csv';
import { formatMinorPlain } from '../shared/money';
import { err, ok, type Result } from '../shared/result';

/**
 * Export CSV (Story 9.9, EXP-001): the person's confirmed entries, or a summary of their accounts, as a file they keep. It is the
 * decrypted data leaving wmbugo's control, so the app confirms first. The cell writer is the Story 7.3 one (`shared/csv`): a cell that
 * starts with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with `'`. Files are UTF-8 with a byte order mark, comma
 * separated, CRLF line ends. Pure text produced in pages and handed to a sink, so 10,000 entries never sit in memory at once.
 */
export const TRANSACTIONS_SCHEMA = 'wmbugo-transactions-1';
export const ACCOUNTS_SCHEMA = 'wmbugo-accounts-1';
export const CSV_BOM = String.fromCharCode(0xfeff);
export const CSV_EOL = '\r\n';
const PAGE = 500;

export const TRANSACTION_COLUMNS = ['date', 'time', 'merchant', 'category', 'account', 'account_number', 'type', 'amount', 'currency', 'reference', 'note', 'source', 'entry_id'] as const;
export const ACCOUNT_COLUMNS = ['account', 'type', 'status', 'account_number', 'start_balance', 'money_in', 'money_out', 'end_balance', 'balance_side', 'currency'] as const;

export type ExportKind = 'transactions' | 'accounts';
export type ExportPeriodChoice = 'this_period' | 'last_period' | 'this_year' | 'all_time' | 'custom';

/** `All time` for entries, `This period` for the account summary. */
export const defaultPeriodChoice = (kind: ExportKind): ExportPeriodChoice => (kind === 'transactions' ? 'all_time' : 'this_period');

export interface ExportRange {
  readonly start: string;
  readonly end: string;
}

export type ExportPeriodError = 'RANGE_INVALID' | 'NO_PERIOD';

/** The dates a period choice covers. `All time` runs from the first confirmed entry (or today when there is none) to today. */
export function resolveExportPeriod(
  choice: ExportPeriodChoice,
  today: string,
  profile: PeriodProfile,
  firstEntryDate: string | null,
  custom?: { readonly start: string; readonly end: string },
): Result<ExportRange, ExportPeriodError> {
  switch (choice) {
    case 'this_period': {
      const p = periodFor(today, profile.rule);
      return ok({ start: p.start, end: p.end });
    }
    case 'last_period': {
      const prev = previousPeriod(periodFor(today, profile.rule), profile);
      return prev ? ok({ start: prev.start, end: prev.end }) : err('NO_PERIOD');
    }
    case 'this_year':
      return ok({ start: `${today.slice(0, 4)}-01-01`, end: today });
    case 'all_time':
      return ok({ start: firstEntryDate !== null && firstEntryDate < today ? firstEntryDate : today, end: today });
    case 'custom':
      if (!custom || !isLocalDate(custom.start) || !isLocalDate(custom.end) || custom.start > custom.end) return err('RANGE_INVALID');
      return ok({ start: custom.start, end: custom.end });
  }
}

/** `wmbugo-transactions-2026-01-01-to-2026-11-08.csv`. */
export const exportFileName = (kind: ExportKind, range: ExportRange): string => `wmbugo-${kind === 'transactions' ? 'transactions' : 'accounts'}-${range.start}-to-${range.end}.csv`;

/** The last four digits as `••4821`. Full account numbers are never stored, so never exported. */
export function maskedNumber(digits: string | null | undefined): string {
  const d = (digits ?? '').replace(/\D/g, '');
  return d.length === 0 ? '' : `••${d.slice(-4)}`;
}

/** A header value on one line: a name with a line break must not start a row. */
const oneLine = (s: string): string => s.replace(/[\r\n\t]+/g, ' ').trim();

export interface ExportOptions {
  readonly range: ExportRange;
  /** null exports every account. */
  readonly accountIds: readonly string[] | null;
  /** Names of the chosen accounts, for the `# Filters` line; empty when all. */
  readonly accountNames: readonly string[];
  readonly includeNumbers: boolean;
  /** Account id to the digits the person gave it. The app does not store account numbers today, so this is empty. */
  readonly numbers: ReadonlyMap<string, string>;
  readonly timezoneId: string;
  readonly currency: string;
  readonly exponent: number;
}

export interface ExportHooks {
  onProgress?(done: number, total: number): void;
  isCancelled?(): boolean;
}

export type ExportError = 'CANCELLED' | 'AMOUNT_NOT_WRITABLE' | 'WRITE_FAILED';

function headerLines(schema: string, o: ExportOptions): string[] {
  const filters = o.accountIds === null || o.accountNames.length === 0 ? 'all' : o.accountNames.map(oneLine).join('; ');
  return [
    `# Period ${o.range.start} to ${o.range.end} (inclusive)`,
    `# Filters: Accounts ${filters}`,
    `# Timezone ${oneLine(o.timezoneId)}`,
    `# Currency ${oneLine(o.currency)}`,
    `# Schema ${schema}`,
    '# Includes confirmed entries only',
  ];
}

const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');

const ENTRY_WHERE =
  "t.status = 'confirmed' AND t.removed_at IS NULL AND t.event_type IN ('expense','income','transfer','refund','adjustment') AND t.local_date BETWEEN ? AND ?";

function entryFilter(o: ExportOptions): { sql: string; params: (string | number)[] } {
  const ids = o.accountIds;
  if (ids === null) return { sql: ENTRY_WHERE, params: [o.range.start, o.range.end] };
  return { sql: `${ENTRY_WHERE} AND EXISTS (SELECT 1 FROM posting px WHERE px.transaction_id = t.id AND px.account_id IN (${marks(ids.length)}))`, params: [o.range.start, o.range.end, ...ids] };
}

const hhmm = (instantMs: number, tz: string): string => {
  const m = localMinutesOfDay(instantMs, tz);
  if (!m.ok) return '';
  return `${String(Math.floor(m.value / 60)).padStart(2, '0')}:${String(m.value % 60).padStart(2, '0')}`;
};

async function write(sink: ByteSink, text: string): Promise<boolean> {
  try {
    await sink.write(utf8Encode(text));
    return true;
  } catch {
    return false;
  }
}

/** How many confirmed entries a transactions export would write, for the progress line. */
export async function countExportEntries(db: Querier, o: ExportOptions): Promise<number> {
  const f = entryFilter(o);
  return Number((await db.query(`SELECT COUNT(*) FROM "transaction" t WHERE ${f.sql}`, f.params))[0]?.[0] ?? 0);
}

/**
 * Writes the transactions file: one row per split part (the same `entry_id`), one row per transfer leg (`transfer_out` and
 * `transfer_in`), amounts unsigned with `type` carrying the direction. Returns how many entries were written. Cancelling stops
 * between pages and returns `CANCELLED`; the caller deletes the partial document.
 */
export async function exportTransactionsCsv(db: Querier, o: ExportOptions, sink: ByteSink, hooks: ExportHooks = {}): Promise<Result<{ entries: number }, ExportError>> {
  const total = await countExportEntries(db, o);
  const head = CSV_BOM + [...headerLines(TRANSACTIONS_SCHEMA, o), csvRow(TRANSACTION_COLUMNS)].join(CSV_EOL) + CSV_EOL;
  if (!(await write(sink, head))) return err('WRITE_FAILED');
  const f = entryFilter(o);
  const inFilter = (id: string) => o.accountIds === null || o.accountIds.includes(id);
  let done = 0;
  let cursorDate = '';
  let cursorId = '';
  hooks.onProgress?.(0, total);
  for (;;) {
    if (hooks.isCancelled?.()) return err('CANCELLED');
    const page = await db.query(
      `SELECT t.id, t.local_date, t.occurred_at_utc, t.timezone_id, t.original_description, t.event_type, t.amount_minor, t.reference, t.note, (SELECT sr.source_kind FROM source_record sr WHERE sr.transaction_id = t.id ORDER BY sr.created_at, sr.id LIMIT 1) FROM "transaction" t WHERE ${f.sql} AND (t.local_date > ? OR (t.local_date = ? AND t.id > ?)) ORDER BY t.local_date, t.id LIMIT ${PAGE}`,
      [...f.params, cursorDate, cursorDate, cursorId],
    );
    if (page.length === 0) break;
    const ids = page.map((r) => String(r[0]));
    const splits = new Map<string, { category: string; amountMinor: number }[]>();
    for (const r of await db.query(`SELECT s.transaction_id, c.name, s.amount_minor FROM split s JOIN category c ON c.id = s.category_id WHERE s.transaction_id IN (${marks(ids.length)}) ORDER BY s.transaction_id, s.id`, ids)) {
      const k = String(r[0]);
      splits.set(k, [...(splits.get(k) ?? []), { category: String(r[1]), amountMinor: Number(r[2]) }]);
    }
    const postings = new Map<string, { accountId: string; account: string; signed: number }[]>();
    for (const r of await db.query(`SELECT p.transaction_id, a.id, a.name, p.signed_amount_minor FROM posting p JOIN account a ON a.id = p.account_id WHERE p.transaction_id IN (${marks(ids.length)}) ORDER BY p.transaction_id, p.signed_amount_minor, p.id`, ids)) {
      const k = String(r[0]);
      postings.set(k, [...(postings.get(k) ?? []), { accountId: String(r[1]), account: String(r[2]), signed: Number(r[3]) }]);
    }

    const lines: string[] = [];
    for (const r of page) {
      const id = String(r[0]);
      const type = String(r[5]);
      const when = [String(r[1]), hhmm(Number(r[2]), String(r[3]))];
      const common = (account: { accountId: string; account: string }, kind: string, category: string, minor: number): string | null => {
        const amount = formatMinorPlain(minor, o.exponent);
        if (!amount.ok) return null;
        const digits = o.includeNumbers ? maskedNumber(o.numbers.get(account.accountId)) : '';
        return csvRow([when[0], when[1], r[4] === null ? '' : String(r[4]), category, account.account, digits, kind, amount.value, o.currency, r[7] === null ? '' : String(r[7]), r[8] === null ? '' : String(r[8]), r[9] === null ? '' : String(r[9]), id]);
      };
      const legs = (postings.get(id) ?? []).filter((p) => inFilter(p.accountId));
      if (type === 'transfer') {
        for (const leg of legs) {
          const line = common(leg, leg.signed < 0 ? 'transfer_out' : 'transfer_in', '', Math.abs(leg.signed));
          if (line === null) return err('AMOUNT_NOT_WRITABLE');
          lines.push(line);
        }
      } else if (type === 'adjustment') {
        for (const leg of legs) {
          const line = common(leg, 'adjustment', '', Math.abs(leg.signed));
          if (line === null) return err('AMOUNT_NOT_WRITABLE');
          lines.push(line);
        }
      } else {
        const account = legs[0] ?? (postings.get(id) ?? [])[0] ?? { accountId: '', account: '' };
        const parts = splits.get(id) ?? [{ category: '', amountMinor: Number(r[6]) }];
        for (const part of parts) {
          const line = common(account, type, part.category, part.amountMinor);
          if (line === null) return err('AMOUNT_NOT_WRITABLE');
          lines.push(line);
        }
      }
    }
    if (lines.length > 0 && !(await write(sink, lines.join(CSV_EOL) + CSV_EOL))) return err('WRITE_FAILED');
    done += page.length;
    hooks.onProgress?.(done, total);
    cursorDate = String(page[page.length - 1]![1]);
    cursorId = String(page[page.length - 1]![0]);
    if (page.length < PAGE) break;
  }
  return ok({ entries: done });
}

const COUNTED = "t.removed_at IS NULL AND t.status IN ('confirmed','reversed') AND (p.posting_kind <> 'normal' OR a.opening_effective_at IS NULL OR t.occurred_at_utc >= a.opening_effective_at)";
const balanceUpTo = (cmp: '<' | '<=') =>
  `(SELECT COALESCE(SUM(p.signed_amount_minor), 0) FROM posting p JOIN "transaction" t ON t.id = p.transaction_id WHERE p.account_id = a.id AND ${COUNTED} AND t.local_date ${cmp} ?)`;
const flow = (sign: '>' | '<') =>
  `(SELECT COALESCE(SUM(p.signed_amount_minor), 0) FROM posting p JOIN "transaction" t ON t.id = p.transaction_id WHERE p.account_id = a.id AND p.posting_kind = 'normal' AND ${COUNTED} AND p.signed_amount_minor ${sign} 0 AND t.local_date BETWEEN ? AND ?)`;

/**
 * Writes the account summary: for each account the balance at the start of the period, what came in and went out, and the balance
 * at its end, from the same postings as the Accounts screen. Balances are unsigned with `balance_side` `have` or `owe`; an account
 * with no balance set has empty balance cells and `not set`, never 0. Returns how many accounts were written.
 */
export async function exportAccountsCsv(db: Querier, o: ExportOptions, sink: ByteSink, hooks: ExportHooks = {}): Promise<Result<{ accounts: number }, ExportError>> {
  const filter = o.accountIds === null ? '' : ` WHERE a.id IN (${marks(o.accountIds.length)})`;
  const rows = await db.query(
    `SELECT a.id, a.name, a.type, a.status, a.balance_not_set, ${balanceUpTo('<')}, ${flow('>')}, ${flow('<')}, ${balanceUpTo('<=')} FROM account a${filter} ORDER BY a.sort_order, a.id`,
    [o.range.start, o.range.start, o.range.end, o.range.start, o.range.end, o.range.end, ...(o.accountIds ?? [])],
  );
  if (hooks.isCancelled?.()) return err('CANCELLED');
  const head = CSV_BOM + [...headerLines(ACCOUNTS_SCHEMA, o), csvRow(ACCOUNT_COLUMNS)].join(CSV_EOL) + CSV_EOL;
  if (!(await write(sink, head))) return err('WRITE_FAILED');
  const lines: string[] = [];
  for (const r of rows) {
    const notSet = Number(r[4]) === 1;
    const cell = (minor: number): string | null => {
      const v = formatMinorPlain(Math.abs(minor), o.exponent);
      return v.ok ? v.value : null;
    };
    const start = cell(Number(r[5]));
    const inn = cell(Number(r[6]));
    const out = cell(Number(r[7]));
    const end = cell(Number(r[8]));
    if (start === null || inn === null || out === null || end === null) return err('AMOUNT_NOT_WRITABLE');
    const digits = o.includeNumbers ? maskedNumber(o.numbers.get(String(r[0]))) : '';
    lines.push(csvRow([String(r[1]), String(r[2]), String(r[3]), digits, notSet ? '' : start, inn, out, notSet ? '' : end, notSet ? 'not set' : Number(r[8]) < 0 ? 'owe' : 'have', o.currency]));
  }
  if (lines.length > 0 && !(await write(sink, lines.join(CSV_EOL) + CSV_EOL))) return err('WRITE_FAILED');
  hooks.onProgress?.(rows.length, rows.length);
  return ok({ accounts: rows.length });
}

/** The day after a period ends: used by callers that want the first day not covered. */
export const dayAfter = (date: string): string => addDays(date, 1);
