import { FakeClock } from '../../shared/clock';
import { createRedactingLogger } from '../../shared/logger';
import { createIdGenerator, seededRandom } from '../../shared/uuid';
import { NodeSqliteDatabase } from '../../testing/nodeSqlite';
import { recordEntry } from '../../testing/capture';
import { findRegion } from '../../profile/regions';
import { SetUpProfile } from '../../usecases/setUpProfile';
import { LedgerWriter } from '../../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from '../../ledger/accountCommands';
import { entryShape, RemoveEntry } from '../../ledger/entryCommands';
import { RejectEntry } from '../../ledger/editCommands';
import { RunDailyPurge } from '../../ledger/purge';
import { SubmitCapture } from '../submitCapture';
import { guessMapping } from './mapping';
import { csvFingerprint, IMPORT_CLASSES, planCsvImport, type ImportClass, type ImportPlan } from './plan';
import { fingerprintsOf, loadImportPlanContext } from './planContext';
import { readCsv, type CsvReadResult } from './read';
import { validateCsvRows, type CsvAccountChoice, type CsvCandidate, type CsvProfile, type ValidatedRow } from './rows';

const NOW = Date.UTC(2026, 10, 25, 10, 0, 0);
const PROFILE: CsvProfile = { currency: 'GBP', timezoneId: 'Europe/London' };

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Europe/London');
  const writer = new LedgerWriter({
    uow: db,
    clock,
    newId: createIdGenerator(clock, seededRandom(21)),
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
  return { db, clock, writer, add };
}

function validated(text: string, account: CsvAccountChoice, flipSign = false): { read: CsvReadResult; rows: ValidatedRow[] } {
  const r = readCsv(new TextEncoder().encode(text));
  if (!r.ok) throw new Error(r.code);
  const guessed = guessMapping(r.value.header, r.value.sample);
  // An ambiguous day/month order is the person's to answer in the wizard; these fixtures are all day first.
  const mapping = { ...guessed, flipSign, dateFormat: guessed.dateFormat ?? ('DD/MM/YYYY' as const) };
  return { read: r.value, rows: [...validateCsvRows(r.value.rows, mapping, PROFILE, account).rows] };
}

/** What 9.4 will do for a `new` row: submit it through SubmitCapture under its fingerprint. */
async function commit(writer: LedgerWriter, c: CsvCandidate, fingerprint: string) {
  return writer.run(
    SubmitCapture,
    {
      submissionId: fingerprint,
      sourceKind: 'csv',
      ...(c.reference ? { reference: c.reference } : {}),
      entry: {
        kind: c.direction === 'out' ? 'expense' : 'income',
        amountMinor: c.amountMinor,
        categoryId: c.direction === 'out' ? 'cat_food' : 'cat_in_salary',
        accountId: c.accountId,
        merchant: c.description,
        occurredAtMs: Date.UTC(Number(c.localDate.slice(0, 4)), Number(c.localDate.slice(5, 7)) - 1, Number(c.localDate.slice(8, 10)), 12),
      },
    },
    'user',
  );
}

const classes = (plan: ImportPlan): ImportClass[] => plan.rows.map((r) => r.class);
const HEAD = 'Date,Description,Amount,Reference\n';

describe('planCsvImport (Story 9.3, IMP-004)', () => {
  it('every row gets exactly one class and the counts add up to the rows planned', async () => {
    const { db, add } = await setup();
    const acc = await add('Current', 'bank');
    const { rows } = validated(`${HEAD}20/10/2026,Tesco,-12.50,\n21/10/2026,Salary,2000.00,\n99/99/2026,Broken,-1.00,\n22/10/2026,Shop,abc,\n`, { kind: 'single', accountId: acc });
    const plan = planCsvImport(rows, await loadImportPlanContext(db, rows, 'file-1'));
    expect(plan.rows).toHaveLength(4);
    expect(IMPORT_CLASSES.reduce((n, k) => n + plan.counts[k], 0)).toBe(4);
    expect(classes(plan)).toEqual(['new', 'new', 'error', 'error']);
    expect(plan.rows[2]!.errors[0]!.code).toBe('INVALID_DATE');
    expect(plan.rows[2]).toMatchObject({ candidate: null, fingerprint: null });
  });

  it('PRD fixture: two PRET A MANGER 3.50 rows on 20 Oct with no references are both new and neither is flagged; an overlapping later file gives the same two fingerprints and both are already_recorded', async () => {
    const { db, writer, add } = await setup();
    const acc = await add('Current', 'bank');
    const first = validated(`${HEAD}20/10/2026,PRET A MANGER,-3.50,\n20/10/2026,PRET A MANGER,-3.50,\n`, { kind: 'single', accountId: acc });
    const plan1 = planCsvImport(first.rows, await loadImportPlanContext(db, first.rows, 'file-1'));
    expect(classes(plan1)).toEqual(['new', 'new']);
    expect(plan1.rows[0]!.fingerprint).not.toBe(plan1.rows[1]!.fingerprint); // the occurrence index keeps identical rows apart
    for (const r of plan1.rows) expect((await commit(writer, r.candidate!, r.fingerprint!)).ok).toBe(true);

    // A later file covering 20 to 31 Oct holds the same two rows and more.
    const second = validated(`${HEAD}20/10/2026,PRET A MANGER,-3.50,\n20/10/2026,PRET A MANGER,-3.50,\n25/10/2026,Costa,-2.10,\n31/10/2026,Rent,-500.00,\n`, { kind: 'single', accountId: acc });
    const plan2 = planCsvImport(second.rows, await loadImportPlanContext(db, second.rows, 'file-2'));
    expect(classes(plan2).slice(0, 2)).toEqual(['already_recorded', 'already_recorded']);
    expect(plan2.rows.map((r) => r.fingerprint).slice(0, 2)).toEqual(plan1.rows.map((r) => r.fingerprint));
    expect(plan2.counts.already_recorded).toBe(2);
    expect(plan2.rows[0]!.matchId).toBeTruthy();
  });

  it('PRD fixture: a 200-row file planned a second time after import gives 200 already_recorded and 0 of any other class', async () => {
    const { db, writer, add } = await setup();
    const acc = await add('Current', 'bank');
    const lines = Array.from({ length: 200 }, (_, i) => `${String((i % 27) + 1).padStart(2, '0')}/10/2026,Shop ${i % 40},-${(i % 9) + 1}.${String((i * 7) % 100).padStart(2, '0')},${i % 3 === 0 ? `REF${i}` : ''}`);
    const text = `${HEAD}${lines.join('\n')}\n`;
    const a = validated(text, { kind: 'single', accountId: acc });
    const plan1 = planCsvImport(a.rows, await loadImportPlanContext(db, a.rows, 'f1'));
    expect(plan1.counts.error).toBe(0);
    for (const r of plan1.rows) if (r.class === 'new') expect((await commit(writer, r.candidate!, r.fingerprint!)).ok).toBe(true);
    const again = planCsvImport(a.rows, await loadImportPlanContext(db, a.rows, 'f2'));
    expect(again.counts.already_recorded).toBe(200);
    expect(IMPORT_CLASSES.filter((k) => k !== 'already_recorded').every((k) => again.counts[k] === 0)).toBe(true);
  });

  it('a row with a reference uses (reference, direction, event type): the same bank row in another file is the same row, whatever its account or wording', () => {
    const base = { row: 2, direction: 'out', amountMinor: 350, localDate: '2026-10-20', description: 'PRET', merchant: 'pret', currency: 'GBP', foreign: false } as const;
    const a = csvFingerprint({ ...base, accountId: 'a', reference: 'REF-1' } as CsvCandidate, 1);
    expect(csvFingerprint({ ...base, accountId: 'b', description: 'other words', reference: ' ref-1 ' } as CsvCandidate, 5)).toBe(a);
    expect(csvFingerprint({ ...base, direction: 'in', accountId: 'a', reference: 'REF-1' } as CsvCandidate, 1)).not.toBe(a);
    const noRef = csvFingerprint({ ...base, accountId: 'a' } as CsvCandidate, 1);
    expect(csvFingerprint({ ...base, accountId: 'a', description: '  pret ' } as CsvCandidate, 1)).toBe(noRef);
    expect(csvFingerprint({ ...base, accountId: 'a' } as CsvCandidate, 2)).not.toBe(noRef);
    expect(csvFingerprint({ ...base, accountId: 'b' } as CsvCandidate, 1)).not.toBe(noRef);
  });

  it('a row whose reference and direction equal an existing capture\'s (a UPI or bank SMS entry) is already_recorded against it', async () => {
    const { db, writer, add } = await setup();
    const acc = await add('Current', 'bank');
    const sms = await writer.run(
      SubmitCapture,
      { submissionId: 'sms-1', sourceKind: 'sms', reference: 'UTR-998877', entry: { kind: 'expense', amountMinor: 4500, categoryId: 'cat_food', accountId: acc, merchant: 'Swiggy', occurredAtMs: Date.UTC(2026, 9, 20, 12) } },
      'user',
    );
    if (!sms.ok) throw new Error('sms');
    const { rows } = validated(`${HEAD}20/10/2026,SWIGGY ORDER,-45.00,UTR-998877\n`, { kind: 'single', accountId: acc });
    const plan = planCsvImport(rows, await loadImportPlanContext(db, rows, 'f'));
    expect(plan.rows[0]).toMatchObject({ class: 'already_recorded', matchId: sms.value.transactionId });
  });

  it('a reference-less row with the same amount, a date within a day and the same merchant from another source is a possible duplicate, never merged', async () => {
    const { db, writer, add } = await setup();
    const acc = await add('Current', 'bank');
    const manual = await recordEntry(writer, { kind: 'expense', amountMinor: 1250, categoryId: 'cat_food', accountId: acc, merchant: 'Tesco', occurredAtMs: Date.UTC(2026, 9, 21, 9) });
    if (!manual.ok) throw new Error('manual');
    const { rows } = validated(`${HEAD}20/10/2026,TESCO,-12.50,\n`, { kind: 'single', accountId: acc });
    const plan = planCsvImport(rows, await loadImportPlanContext(db, rows, 'f'));
    expect(plan.rows[0]).toMatchObject({ class: 'possible_duplicate', matchId: manual.value.transactionId });
  });

  it('rows from one file are never matched against each other: two equal rows on neighbouring days are both new', async () => {
    const { db, add } = await setup();
    const acc = await add('Current', 'bank');
    const { rows } = validated(`${HEAD}20/10/2026,Tesco,-5.00,\n21/10/2026,Tesco,-5.00,\n`, { kind: 'single', accountId: acc });
    expect(classes(planCsvImport(rows, await loadImportPlanContext(db, rows, 'f')))).toEqual(['new', 'new']);
  });

  it('PRD fixture: a bank 500 CARD PAYMENT out and a card 500 PAYMENT RECEIVED in, one day apart, are a transfer pair and never an expense plus an income', async () => {
    const { db, add } = await setup();
    const bank = await add('Current', 'bank');
    const card = await add('Amex', 'card');
    const text = 'Date,Description,Amount,Account\n03/11/2026,CARD PAYMENT,-500.00,Current\n04/11/2026,PAYMENT RECEIVED,500.00,Amex\n05/11/2026,Coffee,-2.00,Current\n';
    const { rows } = validated(text, { kind: 'column', map: { Current: bank, Amex: card } });
    const plan = planCsvImport(rows, await loadImportPlanContext(db, rows, 'f'));
    expect(classes(plan)).toEqual(['transfer_pair', 'transfer_pair', 'new']);
    expect(plan.rows[0]!.pairRow).toBe(plan.rows[1]!.row);
    expect(plan.rows[1]!.pairRow).toBe(plan.rows[0]!.row);
  });

  it('a pair needs equal amounts, opposite directions, different owned accounts and at most two days: three days apart, or the same account, stays new', async () => {
    const { db, add } = await setup();
    const bank = await add('Current', 'bank');
    const card = await add('Amex', 'card');
    const far = validated('Date,Description,Amount,Account\n01/11/2026,Out,-500.00,Current\n04/11/2026,In,500.00,Amex\n', { kind: 'column', map: { Current: bank, Amex: card } });
    expect(classes(planCsvImport(far.rows, await loadImportPlanContext(db, far.rows, 'f')))).toEqual(['new', 'new']);
    const same = validated('Date,Description,Amount,Account\n01/11/2026,Out,-500.00,Current\n02/11/2026,In,500.00,Current\n', { kind: 'column', map: { Current: bank } });
    expect(classes(planCsvImport(same.rows, await loadImportPlanContext(db, same.rows, 'f')))).toEqual(['new', 'new']);
  });

  it('a row that pairs with an existing entry on another owned account is a transfer_pair against it', async () => {
    const { db, writer, add } = await setup();
    const bank = await add('Current', 'bank');
    const card = await add('Amex', 'card');
    const existing = await recordEntry(writer, { kind: 'income', amountMinor: 50000, categoryId: 'cat_in_salary', accountId: card, merchant: 'Payment received', occurredAtMs: Date.UTC(2026, 10, 4, 12) });
    if (!existing.ok) throw new Error('existing');
    const { rows } = validated(`${HEAD}03/11/2026,CARD PAYMENT,-500.00,\n`, { kind: 'single', accountId: bank });
    const plan = planCsvImport(rows, await loadImportPlanContext(db, rows, 'f'));
    expect(plan.rows[0]).toMatchObject({ class: 'transfer_pair', matchId: existing.value.transactionId });
  });

  it('edge days: the first or last date of the file, when the ledger already holds entries that day for the account, is edge_day_review; elsewhere or with nothing there, rows are new', async () => {
    const { db, writer, add } = await setup();
    const acc = await add('Current', 'bank');
    const other = await add('Savings', 'bank');
    await recordEntry(writer, { kind: 'expense', amountMinor: 999, categoryId: 'cat_food', accountId: acc, merchant: 'Something else', occurredAtMs: Date.UTC(2026, 9, 20, 8) });
    await recordEntry(writer, { kind: 'expense', amountMinor: 777, categoryId: 'cat_food', accountId: other, merchant: 'Other account', occurredAtMs: Date.UTC(2026, 9, 31, 8) });
    const { rows } = validated(`${HEAD}20/10/2026,Costa,-2.10,\n20/10/2026,Greggs,-3.10,\n25/10/2026,Tesco,-12.00,\n31/10/2026,Rent,-500.00,\n`, { kind: 'single', accountId: acc });
    const plan = planCsvImport(rows, await loadImportPlanContext(db, rows, 'f'));
    expect(classes(plan)).toEqual(['edge_day_review', 'edge_day_review', 'new', 'new']); // 31 Oct holds an entry, but on another account
  });

  it('an exact fingerprint match always wins over the edge-day rule', async () => {
    const { db, writer, add } = await setup();
    const acc = await add('Current', 'bank');
    const a = validated(`${HEAD}20/10/2026,Costa,-2.10,\n25/10/2026,Tesco,-1.00,\n`, { kind: 'single', accountId: acc });
    const p1 = planCsvImport(a.rows, await loadImportPlanContext(db, a.rows, 'f1'));
    await commit(writer, p1.rows[0]!.candidate!, p1.rows[0]!.fingerprint!);
    const p2 = planCsvImport(a.rows, await loadImportPlanContext(db, a.rows, 'f2'));
    expect(p2.rows[0]!.class).toBe('already_recorded'); // 20 Oct now holds an entry and is the first day, but this row is that entry
  });

  it('a held pair: the same reference in the opposite direction with an unknown account asks the Story 3.1 question', async () => {
    const { db, writer, add } = await setup();
    const acc = await add('Current', 'bank');
    await writer.run(SubmitCapture, { submissionId: 'sms-2', sourceKind: 'sms', reference: 'R-77', entry: { kind: 'income', amountMinor: 1000, categoryId: 'cat_in_salary', accountId: acc, merchant: 'In', occurredAtMs: Date.UTC(2026, 9, 20, 12) } }, 'user');
    const { rows } = validated(`${HEAD}20/10/2026,Out,-10.00,R-77\n`, { kind: 'single', accountId: acc });
    const plan = planCsvImport(rows, await loadImportPlanContext(db, rows, 'f'));
    expect(plan.rows[0]!.class).toBe('held_pair');
    expect(plan.rows[0]!.question).toBeTruthy();
  });

  it('a foreign-currency row is foreign_currency, never converted', async () => {
    const { db, add } = await setup();
    const acc = await add('Current', 'bank');
    const { rows } = validated('Date,Description,Amount,Currency\n20/10/2026,Hotel,-120.00,EUR\n21/10/2026,Shop,-5.00,GBP\n', { kind: 'single', accountId: acc });
    const plan = planCsvImport(rows, await loadImportPlanContext(db, rows, 'f'));
    expect(classes(plan)).toEqual(['foreign_currency', 'new']);
  });

  describe('rows the app removed before (Story 3.12, FIN-014)', () => {
    it('a removed entry that is still in the ledger: deleted is previously_deleted, rejected is previously_rejected, by fingerprint', async () => {
      const { db, writer, add } = await setup();
      const acc = await add('Current', 'bank');
      const a = validated(`${HEAD}20/10/2026,Costa,-2.10,B1\n21/10/2026,Greggs,-3.10,B2\n22/10/2026,Tesco,-4.10,B3\n`, { kind: 'single', accountId: acc });
      const p1 = planCsvImport(a.rows, await loadImportPlanContext(db, a.rows, 'f1'));
      const ids: string[] = [];
      for (const r of p1.rows) {
        const s = await commit(writer, r.candidate!, r.fingerprint!);
        if (!s.ok) throw new Error('commit');
        ids.push(s.value.transactionId);
      }
      expect((await writer.run(RemoveEntry, { transactionId: ids[0]! }, 'user')).ok).toBe(true);
      await db.query("UPDATE \"transaction\" SET status = 'needs_review' WHERE id = ?", [ids[1]!]);
      expect((await writer.run(RejectEntry, { transactionId: ids[1]! }, 'user')).ok).toBe(true);
      const p2 = planCsvImport(a.rows, await loadImportPlanContext(db, a.rows, 'f2'));
      expect(classes(p2)).toEqual(['previously_deleted', 'previously_rejected', 'already_recorded']);
    });

    it('PRD fixture: a capture rejected in January and purged after 90 days; the May row with the same bank reference is previously_rejected', async () => {
      const { db, writer, clock, add } = await setup();
      const acc = await add('Current', 'bank');
      const sub = await writer.run(
        SubmitCapture,
        { submissionId: 'sms-jan', sourceKind: 'sms', reference: 'BANKREF-1', entry: { kind: 'expense', amountMinor: 4200, categoryId: 'cat_food', accountId: acc, merchant: 'Cafe', occurredAtMs: Date.UTC(2026, 9, 20, 12) } },
        'user',
      );
      if (!sub.ok) throw new Error('sub');
      await db.query("UPDATE \"transaction\" SET status = 'needs_review' WHERE id = ?", [sub.value.transactionId]);
      expect((await writer.run(RejectEntry, { transactionId: sub.value.transactionId }, 'user')).ok).toBe(true);
      clock.advance(91 * 86_400_000);
      expect((await writer.run(RunDailyPurge, {}, 'system')).ok).toBe(true);
      expect(await db.query('SELECT count(*) FROM "transaction" WHERE id = ?', [sub.value.transactionId])).toEqual([[0]]); // purged: only a hash is left
      const { rows } = validated(`${HEAD}20/10/2026,CAFE,-42.00,BANKREF-1\n`, { kind: 'single', accountId: acc });
      const plan = planCsvImport(rows, await loadImportPlanContext(db, rows, 'may'));
      expect(plan.rows[0]!.class).toBe('previously_rejected');
    });
  });

  it('rows the account column sends to Don\'t import these rows are not in the plan', async () => {
    const { db, add } = await setup();
    const acc = await add('Current', 'bank');
    const { rows } = validated('Date,Description,Amount,Account\n20/10/2026,A,-1.00,Current\n20/10/2026,B,-2.00,Joint\n', { kind: 'column', map: { Current: acc, Joint: null } });
    const plan = planCsvImport(rows, await loadImportPlanContext(db, rows, 'f'));
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]!.candidate!.description).toBe('A');
  });

  it('fingerprintsOf and the plan agree, so what 9.4 commits is what the next plan finds', async () => {
    const { db, add } = await setup();
    const acc = await add('Current', 'bank');
    const { rows } = validated(`${HEAD}20/10/2026,Same,-1.00,\n20/10/2026,Same,-1.00,\n20/10/2026,Same,-1.00,R\n`, { kind: 'single', accountId: acc });
    const plan = planCsvImport(rows, await loadImportPlanContext(db, rows, 'f'));
    const fp = fingerprintsOf(rows);
    expect(plan.rows.map((r) => r.fingerprint)).toEqual([2, 3, 4].map((n) => fp.get(n)));
  });
});

describe('planCsvImport at size (Story 9.3)', () => {
  it('a 5,000-row file against 10k ledger entries plans within 3 seconds and reports progress every 250 rows', async () => {
    const { db, add } = await setup();
    const acc = await add('Current', 'bank');
    const other = await add('Savings', 'bank');
    // 10,000 ledger entries across Jan to Dec 2025, written straight into the tables (the plan only reads them).
    const day = (i: number) => new Date(Date.UTC(2025, 0, 1 + (i % 365))).toISOString().slice(0, 10);
    await db.query('BEGIN');
    for (let i = 0; i < 10_000; i++) {
      const id = `bulk-${i}`;
      await db.query(
        `INSERT INTO "transaction" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, original_description, created_at, updated_at, tags_json) VALUES (?, 'expense', 'confirmed', ?, ?, ?, 'Europe/London', ?, 1, 1, '[]')`,
        [id, 100 + (i % 900), Date.UTC(2025, 0, 1 + (i % 365), 12), day(i), `Merchant ${i % 300}`],
      );
      await db.query("INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor, posting_kind) VALUES (?, ?, ?, 'out', ?, 'normal')", [`p-${i}`, id, i % 2 === 0 ? acc : other, -(100 + (i % 900))]);
    }
    await db.query('COMMIT');
    const lines = Array.from({ length: 5000 }, (_, i) => `${String((i % 28) + 1).padStart(2, '0')}/${String((i % 12) + 1).padStart(2, '0')}/2025,Merchant ${(i * 7) % 300},-${1 + ((i * 3) % 9)}.${String((i * 11) % 100).padStart(2, '0')},`);
    const { rows } = validated(`${HEAD}${lines.join('\n')}\n`, { kind: 'single', accountId: acc });
    const ctx = await loadImportPlanContext(db, rows, 'big');
    const progress: number[] = [];
    const started = Date.now();
    const plan = planCsvImport(rows, ctx, { onProgress: (done) => void progress.push(done) });
    const elapsed = Date.now() - started;
    expect(plan.rows).toHaveLength(5000);
    expect(elapsed).toBeLessThan(3000);
    expect(progress.slice(0, 3)).toEqual([250, 500, 750]);
    expect(progress[progress.length - 1]).toBe(5000);
    expect(progress.every((p, i) => i === 0 || p >= progress[i - 1]!)).toBe(true);
  }, 60_000);
});
