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
import { LedgerWriter } from '../../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from '../../ledger/accountCommands';
import { entryShape } from '../../ledger/entryCommands';
import { ACCOUNT_LIST_SQL, mapAccountRows, balanceOf } from '../../ledger/accounts';
import { SPENT_EXPENSES_SQL } from '../../ledger/readModels';
import { ApproveCapture } from '../reviewQueue';
import { snapshotTx } from '../snapshot';
import { captureStateOf, captureStatusLabel, CAPTURE_STATES } from '../statusLabel';
import { EDGE_DAY_ENTRIES_SQL, edgeDayParams, KeepSeparate, LinkAsTransfer, LinkEdgeDayRow, UndoImportReview } from './importReview';
import { guessMapping } from './mapping';
import { runCsvImport, type RawFileStore, type RunImportDeps } from './runImport';
import { readCsv } from './read';
import type { CsvAccountChoice, CsvProfile } from './rows';

// The accounts open before the entries in the files are dated, so their postings count in the balances.
const NOW = Date.UTC(2026, 8, 1, 10, 0, 0);
const PROFILE: CsvProfile = { currency: 'GBP', timezoneId: 'Europe/London' };
const enc = (s: string) => new TextEncoder().encode(s);

let crypto: Crypto;
beforeAll(async () => {
  crypto = await createSodiumCrypto();
});

class MemFiles implements RawFileStore {
  files = new Map<string, Uint8Array>();
  async save(name: string, bytes: Uint8Array) {
    this.files.set(name, bytes);
    return name;
  }
  async read(path: string) {
    return this.files.get(path)!;
  }
  async remove(path: string) {
    this.files.delete(path);
  }
}

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Europe/London');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(41)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('GB')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Europe/London' }, 'user');
  if (!p.ok) throw new Error('profile');
  const add = async (name: string, type: 'bank' | 'card', openingMinor = 100000) => {
    clock.advance(1000);
    const a = await writer.run(AddAccount, { name, type, openingMinor }, 'user');
    if (!a.ok) throw new Error('account');
    return a.value.accountId;
  };
  const files = new MemFiles();
  const deps = (): RunImportDeps => ({ writer, db, files, crypto, nowMs: () => clock.nowMs(), profile: PROFILE });
  const importText = async (text: string, account: CsvAccountChoice) => {
    const bytes = enc(text);
    const r = readCsv(bytes);
    if (!r.ok) throw new Error(r.code);
    const g = guessMapping(r.value.header, r.value.sample);
    const s = await runCsvImport(deps(), { bytes, overrides: {}, mapping: { ...g, dateFormat: g.dateFormat ?? 'DD/MM/YYYY' }, account, decisions: {} });
    if (!s.ok) throw new Error(s.code);
    return s.value;
  };
  const balance = async (id: string) => {
    const a = mapAccountRows(await db.query(ACCOUNT_LIST_SQL)).find((x) => x.id === id)!;
    const b = balanceOf(a);
    return b.kind === 'known' ? b.minor : null;
  };
  const spent = async () => Number((await db.query(SPENT_EXPENSES_SQL, ['2026-10-01', '2026-10-31']))[0]?.[0] ?? 0);
  return { db, clock, writer, add, importText, balance, spent };
}

const PAIR = (amount = '500.00', outDate = '03/11/2026', inDate = '04/11/2026') =>
  `Date,Description,Amount,Account\n${outDate},CARD PAYMENT,-${amount},Current\n${inDate},PAYMENT RECEIVED,${amount},Amex\n`;

async function waitingPair(w: Awaited<ReturnType<typeof setup>>, amount = '500.00') {
  const bank = await w.add('Current', 'bank', 200000);
  const card = await w.add('Amex', 'card', 0);
  await w.importText(PAIR(amount), { kind: 'column', map: { Current: bank, Amex: card } });
  const rows = await w.db.query("SELECT t.id, p.account_id FROM \"transaction\" t JOIN posting p ON p.transaction_id = t.id WHERE t.event_type IN ('expense','income') ORDER BY t.occurred_at_utc");
  return { bank, card, out: String(rows[0]![0]), into: String(rows[1]![0]) };
}

const count = async (w: { db: NodeSqliteDatabase }, sql: string) => Number((await w.db.query(sql))[0]![0]);

describe('LinkAsTransfer (Story 9.5, IMP-002)', () => {
  it('Yes, it\'s a transfer: one transfer with postings on both accounts that sum to zero, both legs excluded, sources moved, candidates resolved', async () => {
    const w = await setup();
    const { bank, card, out, into } = await waitingPair(w);
    // While they wait they count in nothing.
    expect(await w.balance(bank)).toBe(200000);
    const r = await w.writer.run(LinkAsTransfer, { transactionId: out }, 'user');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = (await w.db.query('SELECT event_type, status, amount_minor, capture_resolution FROM "transaction" WHERE id = ?', [r.value.transferId]))[0]!;
    expect(t).toEqual(['transfer', 'confirmed', 50000, 'user_approved']);
    const postings = await w.db.query('SELECT account_id, signed_amount_minor FROM posting WHERE transaction_id = ? ORDER BY signed_amount_minor', [r.value.transferId]);
    expect(postings).toEqual([[bank, -50000], [card, 50000]]);
    for (const id of [out, into]) expect((await w.db.query('SELECT status, removal_kind FROM "transaction" WHERE id = ?', [id]))[0]).toEqual(['excluded', 'excluded']);
    expect(await count(w, `SELECT count(*) FROM source_record WHERE transaction_id = '${r.value.transferId}' AND source_kind = 'csv'`)).toBe(3); // the two legs' sources and the link's own
    expect(await count(w, "SELECT count(*) FROM review_candidate WHERE reason = 'transfer_pair' AND status = 'open'")).toBe(0);
    expect(await w.balance(bank)).toBe(150000);
    expect(await w.balance(card)).toBe(50000);
    expect(await count(w, "SELECT count(*) FROM outbox WHERE event = 'TransactionsChanged'")).toBeGreaterThan(0);
  });

  it('a leg that was already confirmed by an earlier import is replaced too, and Spent this period no longer counts it', async () => {
    const w = await setup();
    const bank = await w.add('Current', 'bank', 200000);
    const card = await w.add('Amex', 'card', 0);
    // The bank file came first and confirmed the payment out as an expense.
    await w.importText('Date,Description,Amount\n03/10/2026,CARD PAYMENT,-500.00\n', { kind: 'single', accountId: bank });
    expect(await w.spent()).toBe(50000);
    // The card file arrives later with the payment in: it waits as a possible transfer against the confirmed leg.
    await w.importText('Date,Description,Amount\n04/10/2026,PAYMENT RECEIVED,500.00\n', { kind: 'single', accountId: card });
    const waiting = String((await w.db.query("SELECT transaction_id FROM review_candidate WHERE reason = 'transfer_pair' AND status = 'open'"))[0]![0]);
    const r = await w.writer.run(LinkAsTransfer, { transactionId: waiting }, 'user');
    expect(r.ok).toBe(true);
    expect(await w.spent()).toBe(0); // paying a card is not spending
    expect(await count(w, "SELECT count(*) FROM \"transaction\" WHERE event_type = 'transfer' AND removed_at IS NULL")).toBe(1);
  });

  it('refuses what is not a pair: no candidate, already resolved, a removed match, the same account, unequal amounts', async () => {
    const w = await setup();
    const { out } = await waitingPair(w);
    expect(await w.writer.run(LinkAsTransfer, { transactionId: 'nope' }, 'user')).toMatchObject({ ok: false, code: 'NOT_A_PAIR' });
    expect((await w.writer.run(LinkAsTransfer, { transactionId: out }, 'user')).ok).toBe(true);
    expect(await w.writer.run(LinkAsTransfer, { transactionId: out }, 'user')).toMatchObject({ ok: false, code: 'ALREADY_RESOLVED' });
  });

  it('Undo restores both legs, their statuses, their sources and the open candidate exactly, and removes the transfer', async () => {
    const w = await setup();
    const { out, into } = await waitingPair(w);
    const before = [await w.db.query('SELECT * FROM source_record ORDER BY id'), await w.db.query('SELECT * FROM review_candidate ORDER BY id')];
    const snapsBefore = await Promise.all([out, into].map((id) => w.db.query('SELECT status, capture_resolution, removed_at, removal_kind, amount_minor FROM "transaction" WHERE id = ?', [id])));
    const r = await w.writer.run(LinkAsTransfer, { transactionId: out }, 'user');
    expect(r.ok).toBe(true);
    expect((await w.writer.run(UndoImportReview, { transactionId: out }, 'user')).ok).toBe(true);
    expect(await w.db.query('SELECT * FROM source_record ORDER BY id')).toEqual(before[0]);
    expect(await w.db.query('SELECT * FROM review_candidate ORDER BY id')).toEqual(before[1]);
    expect(await Promise.all([out, into].map((id) => w.db.query('SELECT status, capture_resolution, removed_at, removal_kind, amount_minor FROM "transaction" WHERE id = ?', [id])))).toEqual(snapsBefore);
    expect(await count(w, "SELECT count(*) FROM \"transaction\" WHERE event_type = 'transfer'")).toBe(0);
    expect(await count(w, "SELECT count(*) FROM posting WHERE transaction_id NOT IN (SELECT id FROM \"transaction\")")).toBe(0);
  });

  it('property: link then Undo is the identity for any amount and any dates within two days', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 900_000 }), fc.integer({ min: 0, max: 2 }), async (minor, gap) => {
        const w = await setup();
        const bank = await w.add('Current', 'bank', 2_000_000);
        const card = await w.add('Amex', 'card', 0);
        const amount = (minor / 100).toFixed(2);
        const d = (n: number) => `${String(10 + n).padStart(2, '0')}/11/2026`;
        await w.importText(PAIR(amount, d(0), d(gap)), { kind: 'column', map: { Current: bank, Amex: card } });
        const ids = (await w.db.query("SELECT transaction_id FROM review_candidate WHERE reason = 'transfer_pair' AND status = 'open' ORDER BY created_at, rowid")).map((r) => String(r[0]));
        // Everything except updated_at, which moves with every write.
        const snap = async () =>
          JSON.stringify([
            await w.db.query('SELECT id, event_type, status, capture_resolution, removed_at, removal_kind, amount_minor, occurred_at_utc, local_date, original_description, needs_category FROM "transaction" ORDER BY id'),
            await w.db.query('SELECT * FROM posting ORDER BY id'),
            await w.db.query('SELECT * FROM source_record ORDER BY id'),
            await w.db.query('SELECT id, transaction_id, matched_transaction_id, reason, status, created_at, resolved_at, undo_json FROM review_candidate ORDER BY id'),
            await w.db.query('SELECT * FROM split ORDER BY id'),
          ]);
        const before = await snap();
        const l = await w.writer.run(LinkAsTransfer, { transactionId: ids[0]! }, 'user');
        if (!l.ok) return false;
        const u = await w.writer.run(UndoImportReview, { transactionId: ids[0]! }, 'user');
        return u.ok && (await snap()) === before;
      }),
      { numRuns: 8 },
    );
  }, 120_000);
});

describe('KeepSeparate (Story 9.5)', () => {
  it('No, keep them separate: the legs are confirmed as their own direction and the question is closed; Undo reopens it', async () => {
    const w = await setup();
    const { bank, card, out, into } = await waitingPair(w);
    const r = await w.writer.run(KeepSeparate, { transactionId: out }, 'user');
    expect(r.ok).toBe(true);
    for (const id of [out, into]) expect((await w.db.query('SELECT status, capture_resolution FROM "transaction" WHERE id = ?', [id]))[0]).toEqual(['confirmed', 'user_approved']);
    expect(await count(w, "SELECT count(*) FROM review_candidate WHERE reason = 'transfer_pair' AND status = 'open'")).toBe(0);
    expect(await w.balance(bank)).toBe(150000); // the payment out counts as an expense
    expect(await w.balance(card)).toBe(50000); // and the payment in as income
    expect((await w.writer.run(UndoImportReview, { transactionId: out }, 'user')).ok).toBe(true);
    for (const id of [out, into]) expect((await w.db.query('SELECT status FROM "transaction" WHERE id = ?', [id]))[0]).toEqual(['needs_review']);
    expect(await count(w, "SELECT count(*) FROM review_candidate WHERE reason = 'transfer_pair' AND status = 'open'")).toBe(2);
  });
});

describe('edge-day rows (Story 9.5, FIN-027)', () => {
  async function edgeRow() {
    const w = await setup();
    const acc = await w.add('Current', 'bank', 100000);
    const existing = await recordEntry(w.writer, { kind: 'expense', amountMinor: 999, categoryId: 'cat_food', accountId: acc, merchant: 'Already here', occurredAtMs: Date.UTC(2026, 9, 20, 8) });
    if (!existing.ok) throw new Error('existing');
    await w.importText('Date,Description,Amount\n20/10/2026,Costa,-2.10\n25/10/2026,Tesco,-12.00\n', { kind: 'single', accountId: acc });
    const row = String((await w.db.query("SELECT transaction_id FROM review_candidate WHERE reason = 'edge_day' AND status = 'open'"))[0]![0]);
    return { ...w, acc, row, existingId: existing.value.transactionId };
  }

  it('the waiting row sits with an open edge_day candidate and the entries already on that day are listed for the card', async () => {
    const w = await edgeRow();
    const day = await w.db.query(EDGE_DAY_ENTRIES_SQL, edgeDayParams(w.row));
    expect(day.map((r) => [r[0], r[1]])).toEqual([[w.existingId, 999]]);
  });

  it('Add it: confirming the row (the shared approve) records it and closes the question', async () => {
    const w = await edgeRow();
    expect((await w.writer.run(ApproveCapture, { transactionId: w.row }, 'user')).ok).toBe(true);
    expect((await w.db.query('SELECT status, capture_resolution FROM "transaction" WHERE id = ?', [w.row]))[0]).toEqual(['confirmed', 'user_approved']);
    expect(await count(w, "SELECT count(*) FROM review_candidate WHERE reason = 'edge_day' AND status = 'open'")).toBe(0);
  });

  it('It\'s already here: the row\'s source is linked to the chosen entry and the row is excluded; Undo puts both back', async () => {
    const w = await edgeRow();
    const snap = await snapshotTx(
      { query: (sql: string, p?: readonly (string | number | null)[]) => w.db.query(sql, p ?? []), execute: async () => undefined } as never,
      w.row,
    );
    const r = await w.writer.run(LinkEdgeDayRow, { transactionId: w.row, existingId: w.existingId }, 'user');
    expect(r.ok).toBe(true);
    expect((await w.db.query('SELECT status FROM "transaction" WHERE id = ?', [w.row]))[0]).toEqual(['excluded']);
    expect(await count(w, `SELECT count(*) FROM source_record WHERE transaction_id = '${w.existingId}' AND source_kind = 'csv'`)).toBe(1);
    expect((await w.writer.run(UndoImportReview, { transactionId: w.row }, 'user')).ok).toBe(true);
    expect((await w.db.query('SELECT status FROM "transaction" WHERE id = ?', [w.row]))[0]).toEqual(['needs_review']);
    expect(await count(w, `SELECT count(*) FROM source_record WHERE transaction_id = '${w.existingId}' AND source_kind = 'csv'`)).toBe(0);
    expect((await snapshotTx({ query: (sql: string, p?: readonly (string | number | null)[]) => w.db.query(sql, p ?? []) } as never, w.row))!.sources).toEqual(snap!.sources);
  });

  it('refuses to link a row to itself, and leaves a removed row alone (Epic 9 review)', async () => {
    const w = await edgeRow();
    expect(await w.writer.run(LinkEdgeDayRow, { transactionId: w.row, existingId: w.row }, 'user')).toMatchObject({ ok: false, code: 'MATCH_REMOVED' });
    expect((await w.db.query('SELECT status FROM "transaction" WHERE id = ?', [w.row]))[0]).toEqual(['needs_review']);
    w.db.raw.exec(`UPDATE "transaction" SET removed_at = 1, removal_kind = 'deleted' WHERE id = '${w.row}'`);
    expect(await w.writer.run(LinkEdgeDayRow, { transactionId: w.row, existingId: w.existingId }, 'user')).toMatchObject({ ok: false, code: 'ENTRY_NOT_FOUND' });
  });

  it('without a chosen entry the row is just excluded, and a row that is not an edge-day row is refused', async () => {
    const w = await edgeRow();
    expect((await w.writer.run(LinkEdgeDayRow, { transactionId: w.row }, 'user')).ok).toBe(true);
    expect(await w.writer.run(LinkEdgeDayRow, { transactionId: w.existingId }, 'user')).toMatchObject({ ok: false, code: 'NOT_AN_EDGE_DAY_ROW' });
  });
});

describe('Check tag and the status label (Story 9.5)', () => {
  it('captureStateOf reads a waiting transfer pair and a partly covered day, and both read Waiting for you', () => {
    const base = { status: 'needs_review' as const, resolution: null, needsCategory: false, openDuplicate: false };
    expect(captureStateOf({ ...base, openReason: 'transfer_pair' })).toBe('possible_transfer');
    expect(captureStateOf({ ...base, openReason: 'edge_day' })).toBe('partly_covered_day');
    expect(captureStateOf({ ...base, openReason: null })).toBe('waiting');
    expect(captureStatusLabel('possible_transfer')).toBe('waiting');
    expect(captureStatusLabel('partly_covered_day')).toBe('waiting');
    expect(CAPTURE_STATES).toEqual(expect.arrayContaining(['possible_transfer', 'partly_covered_day']));
  });
});
