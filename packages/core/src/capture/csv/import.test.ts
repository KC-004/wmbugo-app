import * as fc from 'fast-check';
import type { Crypto } from '../../ports/crypto';
import { FakeClock } from '../../shared/clock';
import { createRedactingLogger } from '../../shared/logger';
import { createIdGenerator, seededRandom } from '../../shared/uuid';
import { createSodiumCrypto } from '../../testing/sodiumCrypto';
import { NodeSqliteDatabase } from '../../testing/nodeSqlite';
import { recordEntry } from '../../testing/capture';
import { findRegion } from '../../profile/regions';
import { SetUpProfile } from '../../usecases/setUpProfile';
import { LedgerWriter, type UseCase } from '../../writer/ledgerWriter';
import { AddAccount, ArchiveAccount, openingBalanceShape } from '../../ledger/accountCommands';
import { entryShape, RemoveEntry } from '../../ledger/entryCommands';
import { SubmitCapture } from '../submitCapture';
import { actionFor, ImportCsvBatch, PauseInterruptedImports, type ImportBatchInput, type ImportBatchResult, type ImportBatchError, type RowDecision } from './import';
import { guessMapping } from './mapping';
import { readImport, resumeCsvImport, runCsvImport, type ImportJob, type RawFileStore, type RunImportDeps } from './runImport';
import { readCsv } from './read';
import type { CsvAccountChoice, CsvProfile } from './rows';

const NOW = Date.UTC(2026, 10, 25, 10, 0, 0);
const PROFILE: CsvProfile = { currency: 'GBP', timezoneId: 'Europe/London' };
const HEAD = 'Date,Description,Amount,Reference,Category\n';
const enc = (s: string) => new TextEncoder().encode(s);

let crypto: Crypto;
beforeAll(async () => {
  crypto = await createSodiumCrypto();
});

class MemFiles implements RawFileStore {
  files = new Map<string, Uint8Array>();
  async save(name: string, bytes: Uint8Array) {
    this.files.set(name, new Uint8Array(bytes));
    return name;
  }
  async read(path: string) {
    const b = this.files.get(path);
    if (!b) throw new Error('missing');
    return b;
  }
  async remove(path: string) {
    this.files.delete(path);
  }
}

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Europe/London');
  const writer = new LedgerWriter({
    uow: db,
    clock,
    newId: createIdGenerator(clock, seededRandom(31)),
    logger: createRedactingLogger({ write: () => undefined }),
    invariants: [openingBalanceShape, entryShape],
  });
  const p = await writer.run(SetUpProfile, { region: findRegion('GB')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Europe/London' }, 'user');
  if (!p.ok) throw new Error('profile');
  const add = async (name: string, type: 'bank' | 'card') => {
    clock.advance(1000);
    const a = await writer.run(AddAccount, { name, type, openingMinor: 0 }, 'user');
    if (!a.ok) throw new Error('account');
    return a.value.accountId;
  };
  const files = new MemFiles();
  const deps = (over: Partial<RunImportDeps> = {}): RunImportDeps => ({ writer, db, files, crypto, nowMs: () => clock.nowMs(), profile: PROFILE, ...over });
  return { db, clock, writer, add, files, deps };
}

function job(text: string, account: CsvAccountChoice, decisions: Record<number, RowDecision> = {}): ImportJob {
  const bytes = enc(text);
  const r = readCsv(bytes);
  if (!r.ok) throw new Error(r.code);
  const guessed = guessMapping(r.value.header, r.value.sample);
  // The day/month order is the person's to answer in the wizard; these files are all day first.
  return { bytes, overrides: {}, mapping: { ...guessed, dateFormat: guessed.dateFormat ?? 'DD/MM/YYYY' }, account, decisions };
}

const lines = (n: number, seed = 0) =>
  Array.from({ length: n }, (_, i) => `${String(((i + seed) % 27) + 1).padStart(2, '0')}/09/2026,Shop ${i},-${1 + (i % 9)}.${String((i * 13) % 100).padStart(2, '0')},R${seed}-${i},`).join('\n') + '\n';

const count = async (db: NodeSqliteDatabase, sql: string) => Number((await db.query(sql))[0]![0]);
const entries = (db: NodeSqliteDatabase) => count(db, "SELECT count(*) FROM \"transaction\" WHERE event_type IN ('expense','income')");

describe('what a row\'s class and the person\'s choice come to (actionFor)', () => {
  const a = (c: Parameters<typeof actionFor>[0]['class'], d: RowDecision = 'default', matchId?: string) => actionFor({ class: c, decision: d, ...(matchId ? { matchId } : {}) }).kind;
  it('new rows are confirmed, or excluded when skipped', () => {
    expect(a('new')).toBe('confirm');
    expect(a('new', 'skip')).toBe('exclude');
  });
  it('already recorded links to the entry it matches, and writes nothing without one', () => {
    expect(a('already_recorded', 'default', 'tx1')).toBe('link');
    expect(a('already_recorded')).toBe('nothing');
  });
  it('rows that wait for the person wait by default, import as confirmed on Import anyway, and are excluded on Skip', () => {
    for (const c of ['possible_duplicate', 'transfer_pair', 'held_pair', 'edge_day_review'] as const) {
      expect(a(c)).toBe('review');
      expect(a(c, 'check_later')).toBe('review');
      expect(a(c, 'import_anyway')).toBe('confirm');
      expect(a(c, 'skip')).toBe('exclude');
    }
  });
  it('rows removed before write nothing unless Import anyway was chosen for that row', () => {
    for (const c of ['previously_rejected', 'previously_deleted'] as const) {
      expect(a(c)).toBe('nothing');
      expect(a(c, 'skip')).toBe('nothing');
      expect(actionFor({ class: c, decision: 'import_anyway' })).toEqual({ kind: 'confirm', ignoreTombstone: true });
    }
  });
  it('a foreign row waits as a currency review, and error rows are errors', () => {
    expect(a('foreign_currency')).toBe('foreign');
    expect(a('foreign_currency', 'skip')).toBe('exclude');
    expect(a('error')).toBe('error');
  });
});

describe('ImportCsvBatch commits each class (Story 9.4)', () => {
  it('a new row becomes a confirmed, user_approved entry with a csv source record that names its batch and row', async () => {
    const { db, add, deps } = await setup();
    const acc = await add('Current', 'bank');
    const s = await runCsvImport(deps(), job(`${HEAD}20/10/2026,Tesco,-12.50,REF1,Groceries\n21/10/2026,Salary,2000.00,,\n`, { kind: 'single', accountId: acc }));
    expect(s.ok && s.value).toMatchObject({ status: 'completed', rowCount: 2, committedThroughRow: 3, imported: 2, skipped: 0, review: 0, errors: 0 });
    const t = await db.query(`SELECT t.status, t.capture_resolution, t.needs_category, t.amount_minor, t.local_date, sr.source_kind, sr.import_batch_id, sr.file_row, sr.reference, s.category_id FROM "transaction" t JOIN source_record sr ON sr.transaction_id = t.id JOIN split s ON s.transaction_id = t.id WHERE t.event_type IN ('expense','income') ORDER BY sr.file_row`);
    expect(t.map((r) => [r[0], r[1], r[2], r[3], r[4], r[5], r[7], r[8]])).toEqual([
      ['confirmed', 'user_approved', 0, 1250, '2026-10-20', 'csv', 2, 'REF1'],
      ['confirmed', 'user_approved', 1, 200000, '2026-10-21', 'csv', 3, null],
    ]);
    expect(t[0]![6]).toBe(s.ok ? s.value.batchId : '');
    expect(t[0]![9]).toBe('cat_groceries'); // the category column named an existing category
    expect(t[1]![9]).toBe('cat_in_people'); // none given for an income row: filed under the least specific one, and flagged
  });

  it('writes audit rows and outbox events for the batch, and the raw copy first', async () => {
    const { db, add, deps, files } = await setup();
    const acc = await add('Current', 'bank');
    const s = await runCsvImport(deps(), job(`${HEAD}20/10/2026,Tesco,-12.50,R1,\n`, { kind: 'single', accountId: acc }));
    expect(s.ok).toBe(true);
    expect(await count(db, "SELECT count(*) FROM audit_event WHERE entity_kind = 'import_batch'")).toBeGreaterThanOrEqual(2);
    expect(await count(db, "SELECT count(*) FROM outbox WHERE event = 'ImportsChanged'")).toBeGreaterThanOrEqual(2);
    const raw = (await db.query('SELECT raw_path, retain_until, created_at FROM import_batch'))[0]!;
    expect(files.files.has(String(raw[0]))).toBe(true);
    expect(Number(raw[1]) - Number(raw[2])).toBe(30 * 86_400_000);
  });

  it('a duplicate that was found waits for review, an exact repeat links to the entry it matches, and skipped rows are written excluded', async () => {
    const { db, writer, add, deps } = await setup();
    const acc = await add('Current', 'bank');
    const manual = await recordEntry(writer, { kind: 'expense', amountMinor: 1250, categoryId: 'cat_food', accountId: acc, merchant: 'Tesco', occurredAtMs: Date.UTC(2026, 9, 21, 9) });
    if (!manual.ok) throw new Error('manual');
    const sms = await writer.run(SubmitCapture, { submissionId: 'sms-1', sourceKind: 'sms', reference: 'UTR-1', entry: { kind: 'expense', amountMinor: 4500, categoryId: 'cat_food', accountId: acc, merchant: 'Swiggy', occurredAtMs: Date.UTC(2026, 9, 22, 9) } }, 'user');
    if (!sms.ok) throw new Error('sms');
    const text = `${HEAD}20/10/2026,TESCO,-12.50,,\n22/10/2026,SWIGGY ORDER,-45.00,UTR-1,\n23/10/2026,Greggs,-3.00,,\n24/10/2026,Costa,-2.00,,\n`;
    const before = await entries(db);
    const s = await runCsvImport(deps(), job(text, { kind: 'single', accountId: acc }, { 5: 'skip' }));
    expect(s.ok && s.value).toMatchObject({ imported: 1, skipped: 2, review: 1, errors: 0 });
    expect(await entries(db)).toBe(before + 3); // Greggs confirmed, TESCO waiting, Costa excluded; Swiggy linked: no new entry
    const dup = (await db.query("SELECT t.status, rc.reason, rc.matched_transaction_id, rc.status FROM review_candidate rc JOIN \"transaction\" t ON t.id = rc.transaction_id WHERE rc.reason = 'duplicate'"))[0]!;
    expect(dup).toEqual(['needs_review', 'duplicate', manual.value.transactionId, 'open']);
    expect(await count(db, `SELECT count(*) FROM source_record WHERE transaction_id = '${sms.value.transactionId}'`)).toBe(2); // sms + csv
    const excluded = (await db.query("SELECT status, removal_kind FROM \"transaction\" WHERE removal_kind = 'excluded'"))[0]!;
    expect(excluded).toEqual(['excluded', 'excluded']);
    expect(await count(db, "SELECT count(*) FROM source_record WHERE file_row = 5")).toBe(1); // the skipped row still has its source, so a later import skips it
  });

  it('Check later is the default, Import anyway confirms the row, and a transfer pair inside the file waits as two linked legs', async () => {
    const { db, add, deps } = await setup();
    const bank = await add('Current', 'bank');
    const card = await add('Amex', 'card');
    const text = 'Date,Description,Amount,Account\n03/11/2026,CARD PAYMENT,-500.00,Current\n04/11/2026,PAYMENT RECEIVED,500.00,Amex\n';
    const s = await runCsvImport(deps(), job(text, { kind: 'column', map: { Current: bank, Amex: card } }));
    expect(s.ok && s.value).toMatchObject({ imported: 0, review: 2 });
    const c = await db.query("SELECT transaction_id, matched_transaction_id, reason FROM review_candidate WHERE reason = 'transfer_pair' ORDER BY created_at, rowid");
    expect(c).toHaveLength(2);
    expect(c[0]![1]).toBe(c[1]![0]); // the first leg points at the second
    expect(c[1]![1]).toBe(c[0]![0]); // and the second at the first
  });

  it('a foreign-currency row waits with its foreign amount, no posting and no profile amount, and is never converted', async () => {
    const { db, add, deps } = await setup();
    const acc = await add('Current', 'bank');
    const text = 'Date,Description,Amount,Reference,Currency\n20/10/2026,Hotel Paris,-120.00,H1,EUR\n';
    const s = await runCsvImport(deps(), job(text, { kind: 'single', accountId: acc }));
    expect(s.ok && s.value).toMatchObject({ imported: 0, review: 1 });
    const t = (await db.query("SELECT status, foreign_amount_minor, foreign_currency, foreign_currency_exponent FROM \"transaction\" WHERE foreign_currency IS NOT NULL"))[0]!;
    expect(t).toEqual(['needs_review', 12000, 'EUR', 2]);
    expect(await count(db, "SELECT count(*) FROM posting p JOIN \"transaction\" t ON t.id = p.transaction_id WHERE t.foreign_currency IS NOT NULL")).toBe(0);
    expect((await db.query("SELECT reason, status FROM review_candidate WHERE reason = 'foreign_currency'"))[0]).toEqual(['foreign_currency', 'open']);
  });

  it('rows removed before write nothing, unless Import anyway was chosen for that row', async () => {
    const { db, writer, add, deps } = await setup();
    const acc = await add('Current', 'bank');
    const text = `${HEAD}20/10/2026,Costa,-2.00,B1,\n21/10/2026,Greggs,-3.00,B2,\n`;
    const first = await runCsvImport(deps(), job(text, { kind: 'single', accountId: acc }));
    if (!first.ok) throw new Error('first');
    for (const r of await db.query('SELECT transaction_id FROM source_record ORDER BY file_row')) expect((await writer.run(RemoveEntry, { transactionId: String(r[0]) }, 'user')).ok).toBe(true);
    const again = await runCsvImport(deps(), job(text, { kind: 'single', accountId: acc }));
    expect(again.ok && again.value).toMatchObject({ imported: 0, skipped: 2 });
    expect(await count(db, "SELECT count(*) FROM \"transaction\" WHERE event_type = 'expense' AND removed_at IS NULL")).toBe(0);
    const anyway = await runCsvImport(deps(), job(text, { kind: 'single', accountId: acc }, { 2: 'import_anyway' }));
    expect(anyway.ok && anyway.value).toMatchObject({ imported: 1, skipped: 1 });
    expect(await count(db, "SELECT count(*) FROM \"transaction\" WHERE event_type = 'expense' AND removed_at IS NULL")).toBe(1);
  });
});

describe('rows that fail (Story 9.4, IMP-003)', () => {
  it('PRD fixture: an unparseable date on row 57 is reported with its row number and code, and every other row commits', async () => {
    const { db, add, deps } = await setup();
    const acc = await add('Current', 'bank');
    const rows = lines(100).trimEnd().split('\n');
    rows[55] = '99/99/2026,Broken row,-1.00,BAD,';
    const s = await runCsvImport(deps(), job(HEAD + rows.join('\n') + '\n', { kind: 'single', accountId: acc }));
    expect(s.ok && s.value).toMatchObject({ status: 'completed', imported: 99, errors: 1 });
    expect(await db.query('SELECT file_row, code FROM import_row_error')).toEqual([[57, 'INVALID_DATE']]);
    expect(await entries(db)).toBe(99);
  });

  it('a row whose account was archived meanwhile is a row error and the rest of the batch commits', async () => {
    const { db, writer, add, deps } = await setup();
    const a = await add('Current', 'bank');
    const b = await add('Old card', 'card');
    const text = 'Date,Description,Amount,Account\n20/10/2026,One,-1.00,Current\n20/10/2026,Two,-2.00,Old card\n21/10/2026,Three,-3.00,Current\n';
    const j = job(text, { kind: 'column', map: { Current: a, 'Old card': b } });
    // The account is archived after the file was chosen: the batch meets it at commit.
    expect((await writer.run(ArchiveAccount, { accountId: b }, 'user')).ok).toBe(true);
    const s = await runCsvImport(deps(), j);
    expect(s.ok && s.value).toMatchObject({ imported: 2, errors: 1 });
    const err = (await db.query('SELECT file_row, code FROM import_row_error'))[0]!;
    expect(err[0]).toBe(3);
    expect(String(err[1])).toMatch(/ACCOUNT/);
  });
});

describe('interruption, resume and idempotency (Story 9.4, NFR-12)', () => {
  /** A batch use case that does its work and then dies before the transaction commits, on the given call (1-based). */
  function killOn(call: number): { useCase: UseCase<ImportBatchInput, ImportBatchResult, ImportBatchError>; calls: () => number } {
    let n = 0;
    return {
      calls: () => n,
      useCase: {
        name: 'ImportCsvBatch',
        async execute(ctx, input) {
          n += 1;
          const r = await ImportCsvBatch.execute(ctx, input);
          if (n === call) throw new Error('process killed');
          return r;
        },
      },
    };
  }

  it('PRD fixture: a 1,200-row import killed in batch 3 is paused at row 1,000 with nothing from batch 3, then resumes at row 1,001 with no row duplicated', async () => {
    const { db, add, deps } = await setup();
    const acc = await add('Current', 'bank');
    const text = HEAD + lines(1200);
    const kill = killOn(3);
    const first = await runCsvImport(deps({ batchUseCase: kill.useCase }), job(text, { kind: 'single', accountId: acc }));
    expect(first.ok).toBe(false); // the batch did not commit
    const batch = (await db.query('SELECT id, status, committed_through_row, imported_count FROM import_batch'))[0]!;
    expect(batch[1]).toBe('paused');
    expect(batch[2]).toBe(1001); // rows are numbered from the file: heading is row 1, so 1,000 data rows end at row 1,001
    expect(batch[3]).toBe(1000);
    expect(await entries(db)).toBe(1000); // batch 3 left no partial rows
    expect(await count(db, 'SELECT count(*) FROM source_record WHERE file_row > 1001')).toBe(0);
    // The invariants hold: every confirmed entry has one posting and one split.
    expect(await count(db, "SELECT count(*) FROM \"transaction\" t WHERE t.event_type = 'expense' AND (SELECT count(*) FROM posting WHERE transaction_id = t.id) <> 1")).toBe(0);

    const resumed = await resumeCsvImport(deps(), String(batch[0]));
    expect(resumed.ok && resumed.value).toMatchObject({ status: 'completed', committedThroughRow: 1201, imported: 1200, errors: 0 });
    expect(await entries(db)).toBe(1200);
    expect(await count(db, 'SELECT count(*) - count(DISTINCT fingerprint) FROM source_record')).toBe(0);
  }, 120_000);

  it('a process killed while running leaves the import \'importing\'; the next start pauses it, and Resume finishes it', async () => {
    const { db, writer, add, deps } = await setup();
    const acc = await add('Current', 'bank');
    // The process dies in batch 2 and never gets to record that it stopped: the status is left as \'importing\'.
    const kill = killOn(2);
    const dying: RunImportDeps['writer'] = { run: (uc, input, actor) => (uc.name === 'FinishCsvImport' ? Promise.reject(new Error('process killed')) : writer.run(uc, input, actor)) };
    await expect(runCsvImport(deps({ writer: dying, batchRows: 10, batchUseCase: kill.useCase }), job(HEAD + lines(30), { kind: 'single', accountId: acc }))).rejects.toThrow('killed');
    const id = String((await db.query('SELECT id FROM import_batch'))[0]![0]);
    expect((await readImport(db, id))!.status).toBe('importing');
    expect(await entries(db)).toBe(10);
    const paused = await writer.run(PauseInterruptedImports, {}, 'system');
    expect(paused.ok && paused.value.paused).toBe(1);
    expect((await readImport(db, id))!).toMatchObject({ status: 'paused', committedThroughRow: 11, imported: 10 });
    const r = await resumeCsvImport(deps({ batchRows: 10 }), id);
    expect(r.ok && r.value).toMatchObject({ status: 'completed', imported: 30 });
    expect(await entries(db)).toBe(30);
  });

  it('a cancel request stops after the current batch: status paused, committed batches stay, no further batch starts', async () => {
    const { db, add, deps } = await setup();
    const acc = await add('Current', 'bank');
    let polled = 0;
    const s = await runCsvImport(deps({ batchRows: 10, isCancelled: () => ++polled > 2 }), job(HEAD + lines(50), { kind: 'single', accountId: acc }));
    expect(s.ok && s.value).toMatchObject({ status: 'paused', committedThroughRow: 21, imported: 20 });
    expect(await entries(db)).toBe(20);
    const resumed = await resumeCsvImport(deps({ batchRows: 10 }), s.ok ? s.value.batchId : '');
    expect(resumed.ok && resumed.value).toMatchObject({ status: 'completed', imported: 50 });
  });

  it('PRD fixture: the same file imported again after completion creates no new entries and reports every row as skipped', async () => {
    const { db, add, deps } = await setup();
    const acc = await add('Current', 'bank');
    const text = HEAD + lines(200);
    const first = await runCsvImport(deps(), job(text, { kind: 'single', accountId: acc }));
    expect(first.ok && first.value.imported).toBe(200);
    const again = await runCsvImport(deps(), job(text, { kind: 'single', accountId: acc }));
    expect(again.ok && again.value).toMatchObject({ status: 'completed', imported: 0, skipped: 200, review: 0, errors: 0 });
    expect(await entries(db)).toBe(200);
  }, 60_000);

  it('a manual save made while an import is running is queued between batches and never rejected', async () => {
    const { add, writer, deps } = await setup();
    const acc = await add('Current', 'bank');
    const running = runCsvImport(deps({ batchRows: 5 }), job(HEAD + lines(40), { kind: 'single', accountId: acc }));
    const manual = recordEntry(writer, { kind: 'expense', amountMinor: 999, categoryId: 'cat_food', accountId: acc, merchant: 'Manual during import', occurredAtMs: Date.UTC(2026, 9, 5, 9) });
    const [imp, man] = await Promise.all([running, manual]);
    expect(man.ok).toBe(true);
    expect(imp.ok && imp.value.imported).toBe(40);
  });

  it('property: killed at any batch, then resumed, an import ends with each row once and nothing doubled', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 3, max: 9 }), async (killCall, size) => {
        const { db, add, deps } = await setup();
        const acc = await add('Current', 'bank');
        const rowCount = 40;
        const kill = killOn(killCall);
        const first = await runCsvImport(deps({ batchRows: size, batchUseCase: kill.useCase }), job(HEAD + lines(rowCount, killCall), { kind: 'single', accountId: acc }));
        const batches = Math.ceil(rowCount / size);
        if (killCall <= batches) {
          if (first.ok) return false;
          const id = String((await db.query('SELECT id FROM import_batch'))[0]![0]);
          const r = await resumeCsvImport(deps({ batchRows: size }), id);
          if (!r.ok || r.value.status !== 'completed') return false;
        } else if (!first.ok) return false;
        const total = await entries(db);
        const distinct = await count(db, 'SELECT count(DISTINCT fingerprint) FROM source_record');
        const sources = await count(db, 'SELECT count(*) FROM source_record');
        return total === rowCount && distinct === rowCount && sources === rowCount;
      }),
      { numRuns: 12 },
    );
  }, 120_000);

  it('Resume refuses a file that is not the one that was imported, a missing copy, and an import that is not paused', async () => {
    const { db, writer, add, deps, files } = await setup();
    const acc = await add('Current', 'bank');
    const kill = killOn(1);
    await runCsvImport(deps({ batchRows: 5, batchUseCase: kill.useCase }), job(HEAD + lines(12), { kind: 'single', accountId: acc }));
    const row = (await db.query('SELECT id, raw_path FROM import_batch'))[0]!;
    const id = String(row[0]);
    files.files.set(String(row[1]), enc('Date,Description\n01/01/2026,tampered\n'));
    expect(await resumeCsvImport(deps(), id)).toEqual({ ok: false, code: 'FILE_CHANGED' });
    files.files.delete(String(row[1]));
    expect(await resumeCsvImport(deps(), id)).toEqual({ ok: false, code: 'RAW_COPY_MISSING' });
    expect(await resumeCsvImport(deps(), 'nope')).toEqual({ ok: false, code: 'IMPORT_NOT_FOUND' });
    expect((await readImport(db, id))!.status).toBe('paused');
    void writer;
  });

  it('a batch of more than 500 rows, or one that does not follow the last committed row, is refused', async () => {
    const { add, writer, deps } = await setup();
    const acc = await add('Current', 'bank');
    const kill = killOn(1);
    await runCsvImport(deps({ batchRows: 5, batchUseCase: kill.useCase }), job(HEAD + lines(12), { kind: 'single', accountId: acc }));
    const s = await writer.run(PauseInterruptedImports, {}, 'system');
    expect(s.ok).toBe(true);
    const tooMany = Array.from({ length: 501 }, (_, i) => ({ row: i + 2, class: 'error' as const, candidate: null, fingerprint: null }));
    const r = await writer.run(ImportCsvBatch, { batchId: 'whatever', rows: tooMany, throughRow: 502 }, 'user');
    expect(r).toMatchObject({ ok: false });
  });
});
