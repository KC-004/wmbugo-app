import * as fc from 'fast-check';
import { FakeClock } from '../../shared/clock';
import { createRedactingLogger } from '../../shared/logger';
import { createIdGenerator, seededRandom } from '../../shared/uuid';
import { NodeSqliteDatabase } from '../../testing/nodeSqlite';
import { LedgerWriter } from '../../writer/ledgerWriter';
import { findSavedFormat, headerSignature, listSavedFormats, SaveCsvFormat } from './formats';
import { guessMapping, mappingProblems, refreshFormats, withRole, type CsvMapping } from './mapping';
import { readCsv, type CsvDataRow, type CsvReadResult } from './read';
import { normalizeCsvRow, validateCsvRows, type CsvAccountChoice, type CsvProfile } from './rows';

const PROFILE: CsvProfile = { currency: 'GBP', timezoneId: 'Europe/London' };
const enc = (s: string) => new TextEncoder().encode(s);
const read = (text: string, opts = {}): CsvReadResult => {
  const r = readCsv(enc(text), opts);
  if (!r.ok) throw new Error(r.code);
  return r.value;
};
const rowsOf = (cells: string[][], first = 2): CsvDataRow[] => cells.map((c, i) => ({ row: first + i, cells: c }));

describe('guessMapping (Story 9.2, IMP-002)', () => {
  it('reads a UK bank with Paid out and Paid in', () => {
    const r = read('Date,Description,Paid out,Paid in,Balance\n13/11/2026,Tesco,12.50,,987.50\n04/11/2026,Salary,,2000.00,2987.50\n');
    const m = guessMapping(r.header, r.sample);
    expect(m.columns).toEqual({ date: 0, description: 1, debit: 2, credit: 3, balance: 4 });
    expect(m.dateFormat).toBe('DD/MM/YYYY');
    expect(m.flipSign).toBe(false);
    expect(m.confidence.date).toBeGreaterThan(0.8);
    expect(mappingProblems(m)).toEqual([]);
  });

  it('reads Date, Transaction Date, Money out/in, Amount, Reference, Balance headings in any case and with accents', () => {
    const m = guessMapping(['TRANSACTION DATE', 'Name', 'Money Out', 'Money In', 'Transaction ID', 'Saldo'], [['13/11/2026', 'Tesco', '1.00', '', 'abc', '5.00']]);
    expect(m.columns).toMatchObject({ date: 0, description: 1, debit: 2, credit: 3, reference: 4, balance: 5 });
    const g = guessMapping(['Buchungstag', 'Buchungstext', 'Betrag', 'Währung', 'Saldo'], [['03.11.2026', 'Miete', '-1.234,56', 'EUR', '10,00']]);
    expect(g.columns).toEqual({ date: 0, description: 1, amount: 2, currency: 3, balance: 4 });
    expect(g.dateFormat).toBe('DD.MM.YYYY');
    expect(g.numberStyle).toBe('1.234,56');
  });

  it('assigns each column to one role and each role to one column, and claims the specific roles first', () => {
    const m = guessMapping(['Date', 'Date', 'Amount', 'Amount', 'Details'], [['13/11/2026', '13/11/2026', '1.00', '2.00', 'x']]);
    const used = Object.values(m.columns);
    expect(new Set(used).size).toBe(used.length);
    expect(m.columns.date).toBe(0);
    expect(m.columns.amount).toBe(2);
  });

  it('with no recognisable headings the values decide: dates, amounts, and the longest text as the description', () => {
    const m = guessMapping(['A', 'B', 'C', 'D'], [
      ['13/11/2026', 'ABC', 'PRET A MANGER LONDON', '-3.50'],
      ['04/11/2026', 'DEF', 'TESCO STORES 4419', '-12.00'],
    ]);
    expect(m.columns).toEqual({ date: 0, description: 2, amount: 3 });
    expect(m.confidence.date).toBeLessThan(0.9);
  });

  it('an ambiguous day/month order leaves the format open with both candidates, and it needs an answer before the mapping is usable', () => {
    const m = guessMapping(['Date', 'Description', 'Amount'], [['04/05/2026', 'x', '1.00'], ['01/02/2026', 'y', '2.00']]);
    expect(m.dateFormat).toBeNull();
    expect(m.dateCandidates).toEqual(['DD/MM/YYYY', 'MM/DD/YYYY']);
    expect(mappingProblems(m)).toEqual(['dateFormat']);
    expect(mappingProblems(refreshFormats({ ...m, dateFormat: 'MM/DD/YYYY' }, []))).toContain('dateFormat'); // re-derived from the values: still ambiguous
  });

  it('names what is missing: the date, a description or merchant, an amount form', () => {
    expect(mappingProblems(guessMapping(['Foo', 'Bar'], [['x', 'y']]))).toEqual(expect.arrayContaining(['date', 'amount']));
    const onlyDebit = guessMapping(['Date', 'Description', 'Debit'], [['13/11/2026', 'x', '1.00']]);
    expect(mappingProblems(onlyDebit)).toEqual(['amount']); // a debit column alone cannot tell money in
  });

  it('any role can be reassigned or cleared, and a column moves rather than doubles up', () => {
    const base = guessMapping(['Date', 'Description', 'Amount'], [['13/11/2026', 'x', '1.00']]);
    const moved = withRole(base, 'merchant', 1);
    expect(moved.columns.merchant).toBe(1);
    expect(moved.columns.description).toBeUndefined();
    expect(withRole(base, 'amount', null).columns.amount).toBeUndefined();
    expect(withRole(base, 'date', 2).columns).toMatchObject({ date: 2 });
    expect(withRole(base, 'date', 2).columns.amount).toBeUndefined();
    expect(withRole(base, 'description', 1).confidence.description).toBe(1);
  });
});

describe('normalizeCsvRow (Story 9.2)', () => {
  const signed = guessMapping(['Date', 'Description', 'Amount', 'Reference', 'Category'], [['13/11/2026', 'x', '1.00', 'r', 'c']]);
  const n = (cells: string[], mapping: CsvMapping = signed, account?: CsvAccountChoice) => normalizeCsvRow({ row: 7, cells }, mapping, PROFILE, account);

  it('a negative signed amount is money out, a positive is money in, unsigned in minor units, description as written', () => {
    const out = n(['13/11/2026', 'PRET A MANGER, LONDON', '-3.50', 'ref-1', 'Food']);
    expect(out.errors).toEqual([]);
    expect(out.candidate).toMatchObject({
      row: 7,
      direction: 'out',
      amountMinor: 350,
      localDate: '2026-11-13',
      description: 'PRET A MANGER, LONDON',
      reference: 'ref-1',
      categoryName: 'Food',
      currency: 'GBP',
      foreign: false,
    });
    expect(out.candidate!.merchant).toBe('pret a manger, london'); // the Story 3.1 normalizer: lower case, spacing collapsed
    expect(n(['13/11/2026', 'Salary', '2000.00', '', '']).candidate).toMatchObject({ direction: 'in', amountMinor: 200000 });
    expect(n(['13/11/2026', 'x', '-3.50', '', '']).candidate).not.toHaveProperty('reference');
  });

  it('with debit and credit columns a debit is out and a credit is in', () => {
    const dc = guessMapping(['Date', 'Description', 'Paid out', 'Paid in'], [['13/11/2026', 'x', '1.00', '']]);
    expect(n(['13/11/2026', 'Tesco', '12.50', ''], dc).candidate).toMatchObject({ direction: 'out', amountMinor: 1250 });
    expect(n(['13/11/2026', 'Salary', '', '2,000.00'], dc).candidate).toMatchObject({ direction: 'in', amountMinor: 200000 });
  });

  it('flipSign makes positive amounts money out: a card statement that lists charges as positive (PRD fixture)', () => {
    const flip = { ...signed, flipSign: true };
    expect(n(['13/11/2026', 'Amazon', '49.99', '', ''], flip).candidate).toMatchObject({ direction: 'out', amountMinor: 4999 });
    expect(n(['13/11/2026', 'Refund', '-10.00', '', ''], flip).candidate).toMatchObject({ direction: 'in', amountMinor: 1000 });
  });

  it('a time column joins the date and gives an instant that keeps the written day', () => {
    const t = guessMapping(['Date', 'Time', 'Description', 'Amount'], [['13/11/2026', '21:14', 'x', '1.00']]);
    const r = n(['13/11/2026', '21:14', 'x', '-1.00'], t);
    expect(r.candidate).toMatchObject({ localDate: '2026-11-13' });
    expect(r.candidate!.instantMs).toBe(Date.UTC(2026, 10, 13, 21, 14));
  });

  it('a merchant column wins over the description for the normalized merchant', () => {
    const mm = guessMapping(['Date', 'Merchant', 'Description', 'Amount'], [['13/11/2026', 'Tesco', 'CARD PAYMENT 4419', '1.00']]);
    expect(n(['13/11/2026', 'Tesco', 'CARD PAYMENT 4419', '-1.00'], mm).candidate).toMatchObject({ merchant: 'tesco', description: 'CARD PAYMENT 4419' });
  });

  it('a currency other than the profile\'s is valid and foreign, with the amount in that currency\'s decimals, never converted', () => {
    const c = guessMapping(['Date', 'Description', 'Amount', 'Currency'], [['13/11/2026', 'x', '1.00', 'EUR']]);
    expect(n(['13/11/2026', 'Hotel', '-120.00', 'EUR'], c).candidate).toMatchObject({ foreign: true, currency: 'EUR', amountMinor: 12000 });
    expect(n(['13/11/2026', 'Hotel', '-1200', 'HUF'], c).candidate).toMatchObject({ foreign: true, currency: 'HUF', amountMinor: 1200 }); // no decimals
    expect(n(['13/11/2026', 'Shop', '-1.00', 'gbp'], c).candidate).toMatchObject({ foreign: false, currency: 'GBP' });
  });
});

describe('row validation (Story 9.2, IMP-003)', () => {
  const map = guessMapping(['Date', 'Description', 'Amount', 'Currency'], [['13/11/2026', 'x', '1.00', 'GBP']]);
  const v = (cells: string[][], mapping = map, account?: CsvAccountChoice) => validateCsvRows(rowsOf(cells), mapping, PROFILE, account);

  it('each error has its fixed code and copy', () => {
    const r = v([
      ['31/02/2026', 'x', '-1.00', 'GBP'],
      ['13/11/2026', 'x', '12.3.4', 'GBP'],
      ['13/11/2026', 'x', '', 'GBP'],
      ['13/11/2026', 'x', '-1.00', 'XYZ'],
    ]);
    expect(r.rows.map((x) => x.errors.map((e) => [e.code, e.message]))).toEqual([
      [['INVALID_DATE', 'Date "31/02/2026" isn\'t a real date']],
      [['INVALID_AMOUNT', 'Amount "12.3.4" isn\'t a number']],
      [['MISSING_AMOUNT', 'No amount in this row']],
      [['UNKNOWN_CURRENCY', '"XYZ" isn\'t a currency wmbugo knows']],
    ]);
    expect(r.errorCount).toBe(4);
    expect(r.okCount).toBe(0);
  });

  it('a row with a debit and a credit says so, and a row can have several errors', () => {
    const dc = guessMapping(['Date', 'Description', 'Debit', 'Credit'], [['13/11/2026', 'x', '1.00', '']]);
    const r = v([['13/11/2026', 'x', '5.00', '5.00'], ['99/99/2026', 'x', 'abc', '']], dc);
    expect(r.rows[0]!.errors.map((e) => [e.code, e.message])).toEqual([['BOTH_DEBIT_AND_CREDIT', 'This row has both a debit and a credit']]);
    expect(r.rows[1]!.errors.map((e) => e.code)).toEqual(['INVALID_DATE', 'INVALID_AMOUNT']);
  });

  it('a bad row never stops the others: row 57 is reported and every other row still validates (PRD fixture)', () => {
    const cells = Array.from({ length: 100 }, (_, i) => ['13/11/2026', `Shop ${i}`, '-1.00', 'GBP']);
    cells[55] = ['not a date', 'Shop 55', '-1.00', 'GBP'];
    const r = validateCsvRows(rowsOf(cells, 2), map, PROFILE);
    expect(r.errorCount).toBe(1);
    expect(r.okCount).toBe(99);
    expect(r.rows[55]).toMatchObject({ row: 57, candidate: null });
    expect(r.rows[55]!.errors[0]!.code).toBe('INVALID_DATE');
  });

  it('a foreign currency row is valid and marked foreign', () => {
    const r = v([['13/11/2026', 'Hotel', '-50.00', 'EUR']]);
    expect(r.errorCount).toBe(0);
    expect(r.rows[0]!.candidate).toMatchObject({ foreign: true });
  });

  describe('the sign check from a balance column', () => {
    const bal = guessMapping(['Date', 'Description', 'Amount', 'Balance'], [['13/11/2026', 'x', '1.00', '1.00']]);
    const oldestFirst = [
      ['01/11/2026', 'a', '-10.00', '90.00'],
      ['02/11/2026', 'b', '-5.00', '85.00'],
      ['13/11/2026', 'c', '100.00', '185.00'],
      ['04/11/2026', 'd', '-20.00', '165.00'],
    ];
    it('agrees on every checkable pair: SIGN_CONFIRMED, in either row order', () => {
      expect(v(oldestFirst, bal).warning).toBe('SIGN_CONFIRMED');
      expect(v([...oldestFirst].reverse(), bal).warning).toBe('SIGN_CONFIRMED');
    });
    it('moves the opposite way to the signs on most pairs: SIGN_LOOKS_REVERSED, and flipping the sign makes it confirmed', () => {
      const reversed = oldestFirst.map((r) => [r[0]!, r[1]!, r[2]!.startsWith('-') ? r[2]!.slice(1) : `-${r[2]}`, r[3]!]);
      expect(v(reversed, bal).warning).toBe('SIGN_LOOKS_REVERSED');
      expect(v(reversed, { ...bal, flipSign: true }).warning).toBe('SIGN_CONFIRMED');
    });
    it('without a balance column no sign warning is raised, and a single row has nothing to compare', () => {
      expect(v(oldestFirst.map((r) => r.slice(0, 3)), map).warning).toBeNull();
      expect(v([oldestFirst[0]!], bal).warning).toBeNull();
    });
    it('a mixed file (under half the pairs disagree) raises nothing', () => {
      const mixed = [
        ['01/11/2026', 'a', '-10.00', '90.00'],
        ['02/11/2026', 'b', '-5.00', '85.00'],
        ['13/11/2026', 'c', '-5.00', '90.00'], // disagrees
        ['04/11/2026', 'd', '-5.00', '85.00'],
        ['05/11/2026', 'e', '-5.00', '80.00'],
      ];
      expect(v(mixed, bal).warning).toBeNull();
    });
  });

  describe('the account column', () => {
    const acc = guessMapping(['Date', 'Description', 'Amount', 'Account'], [['13/11/2026', 'x', '1.00', 'Current']]);
    const cells = [['13/11/2026', 'a', '-1.00', 'Current'], ['13/11/2026', 'b', '-2.00', 'Joint'], ['13/11/2026', 'c', '-3.00', 'Current'], ['13/11/2026', 'd', '-4.00', 'Old']];
    it('lists the distinct values in file order for the caller to map', () => {
      expect(v(cells, acc).accountValues).toEqual(['Current', 'Joint', 'Old']);
    });
    it('maps each value to an account or to Don\'t import these rows, and an unmapped value is an error', () => {
      const r = v(cells, acc, { kind: 'column', map: { Current: 'acc-1', Joint: 'acc-2', Old: null } });
      expect(r.rows.map((x) => x.candidate?.accountId)).toEqual(['acc-1', 'acc-2', 'acc-1', null]);
      expect(r.rows[3]).toMatchObject({ skipped: true, errors: [] });
      expect(r.okCount).toBe(3);
      expect(r.skippedCount).toBe(1);
      const partial = v(cells, acc, { kind: 'column', map: { Current: 'acc-1' } });
      expect(partial.rows[1]!.errors[0]).toMatchObject({ code: 'UNMAPPED_ACCOUNT', message: 'No account chosen for "Joint"' });
    });
    it('without an account column the whole file goes to the one chosen account', () => {
      const r = v(cells.map((c) => c.slice(0, 3)), map, { kind: 'single', accountId: 'acc-9' });
      expect(r.rows.every((x) => x.candidate?.accountId === 'acc-9')).toBe(true);
    });
  });
});

describe('properties (Story 9.2)', () => {
  const amountText = fc.integer({ min: 1, max: 9_999_999 }).map((n) => (n / 100).toFixed(2));
  const rowArb = fc.record({ day: fc.integer({ min: 1, max: 28 }), month: fc.integer({ min: 1, max: 12 }), desc: fc.constantFrom('Tesco', 'Pret A Manger', 'Salary', 'Uber *trip', 'Rent'), amount: amountText, out: fc.boolean() });
  const pad = (n: number) => String(n).padStart(2, '0');

  it('normalization is deterministic', () => {
    const m = guessMapping(['Date', 'Description', 'Amount'], [['13/11/2026', 'x', '1.00']]);
    fc.assert(
      fc.property(fc.array(rowArb, { minLength: 1, maxLength: 10 }), (rows) => {
        const data = rowsOf(rows.map((r) => [`${pad(r.day)}/${pad(r.month)}/2026`, r.desc, `${r.out ? '-' : ''}${r.amount}`]));
        return JSON.stringify(validateCsvRows(data, m, PROFILE)) === JSON.stringify(validateCsvRows(data, m, PROFILE));
      }),
      { numRuns: 100 },
    );
  });

  it('flipSign applied twice is the identity on direction', () => {
    const base = guessMapping(['Date', 'Description', 'Amount'], [['13/11/2026', 'x', '1.00']]);
    fc.assert(
      fc.property(fc.array(rowArb, { minLength: 1, maxLength: 10 }), (rows) => {
        const data = rowsOf(rows.map((r) => [`${pad(r.day)}/${pad(r.month)}/2026`, r.desc, `${r.out ? '-' : ''}${r.amount}`]));
        const plain = validateCsvRows(data, base, PROFILE).rows.map((x) => x.candidate!.direction);
        const once = validateCsvRows(data, { ...base, flipSign: true }, PROFILE).rows.map((x) => x.candidate!.direction);
        const twice = once.map((d) => (d === 'out' ? 'in' : 'out'));
        return once.every((d, i) => d !== plain[i]) && JSON.stringify(twice) === JSON.stringify(plain);
      }),
      { numRuns: 100 },
    );
  });

  it('debit/credit and signed-amount mappings of the same statement give identical candidates', () => {
    const signed = guessMapping(['Date', 'Description', 'Amount'], [['13/11/2026', 'x', '1.00']]);
    const split = guessMapping(['Date', 'Description', 'Debit', 'Credit'], [['13/11/2026', 'x', '1.00', '']]);
    fc.assert(
      fc.property(fc.array(rowArb, { minLength: 1, maxLength: 10 }), (rows) => {
        const a = rowsOf(rows.map((r) => [`${pad(r.day)}/${pad(r.month)}/2026`, r.desc, `${r.out ? '-' : ''}${r.amount}`]));
        const b = rowsOf(rows.map((r) => [`${pad(r.day)}/${pad(r.month)}/2026`, r.desc, r.out ? r.amount : '', r.out ? '' : r.amount]));
        const ca = validateCsvRows(a, signed, PROFILE).rows.map((x) => x.candidate);
        const cb = validateCsvRows(b, split, PROFILE).rows.map((x) => x.candidate);
        return JSON.stringify(ca) === JSON.stringify(cb);
      }),
      { numRuns: 100 },
    );
  });
});

describe('saved bank formats (Story 9.2)', () => {
  async function setup() {
    const db = new NodeSqliteDatabase().applyRealMigrations();
    const clock = new FakeClock(Date.UTC(2026, 10, 8, 10, 0, 0), 'Europe/London');
    const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(5)), logger: createRedactingLogger({ write: () => undefined }) });
    return { db, writer, clock };
  }
  const file = 'Date,Description,Paid out,Paid in,Balance\n13/11/2026,Tesco,12.50,,987.50\n';

  it('the signature is a SHA-256 of the normalized heading cells and the delimiter: any different cell or delimiter gives another', () => {
    const base = headerSignature(['Date', 'Description', 'Amount'], ',');
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(headerSignature(['date ', 'DESCRIPTION', 'amount'], ',')).toBe(base); // case and spacing are not a different bank
    expect(headerSignature(['Date', 'Details', 'Amount'], ',')).not.toBe(base);
    expect(headerSignature(['Date', 'Description', 'Amount', 'Balance'], ',')).not.toBe(base);
    expect(headerSignature(['Date', 'Description', 'Amount'], ';')).not.toBe(base);
    expect(headerSignature(['Description', 'Date', 'Amount'], ',')).not.toBe(base);
  });

  it('saves the mapping and choices without any row data, and a later file with the same headings finds it', async () => {
    const { db, writer } = await setup();
    const r1 = read(file);
    const mapping = guessMapping(r1.header, r1.sample);
    const saved = await writer.run(SaveCsvFormat, { name: 'Monzo Current', headerSignature: headerSignature(r1.header, ','), mapping, overrides: { delimiter: ',' }, account: { kind: 'single', accountId: 'acc-1' } }, 'user');
    expect(saved.ok).toBe(true);
    const later = read('Date,Description,Paid out,Paid in,Balance\n09/12/2026,Costa,3.00,,500.00\n');
    const found = await findSavedFormat(db, later);
    expect(found).toMatchObject({ name: 'Monzo Current', overrides: { delimiter: ',' }, account: { kind: 'single', accountId: 'acc-1' } });
    expect(found!.mapping.columns).toEqual(mapping.columns);
    expect(found!.mapping.dateFormat).toBe('DD/MM/YYYY');
    // Nothing from any row is in the stored row.
    const stored = (await db.query('SELECT * FROM csv_format')).flat().join(' ');
    for (const secret of ['Tesco', '12.50', '987.50', '13/11/2026', 'Costa']) expect(stored).not.toContain(secret);
  });

  it('returns nothing when any heading cell differs, or the file has no heading row', async () => {
    const { db, writer } = await setup();
    const r1 = read(file);
    await writer.run(SaveCsvFormat, { name: 'Bank', headerSignature: headerSignature(r1.header, ','), mapping: guessMapping(r1.header, r1.sample), overrides: {}, account: null }, 'user');
    expect(await findSavedFormat(db, read('Date,Description,Paid out,Paid in,Saldo\n13/11/2026,Tesco,12.50,,987.50\n'))).toBeNull();
    expect(await findSavedFormat(db, read('Date;Description;Paid out;Paid in;Balance\n13/11/2026;Tesco;12.50;;987.50\n'))).toBeNull();
    expect(await findSavedFormat(db, read('13/11/2026,Tesco,12.50\n', { noHeader: true }))).toBeNull();
  });

  it('saving the same layout again updates it instead of adding a second, in one audited write with an event', async () => {
    const { db, writer, clock } = await setup();
    const r1 = read(file);
    const sig = headerSignature(r1.header, ',');
    const first = await writer.run(SaveCsvFormat, { name: 'Monzo Current', headerSignature: sig, mapping: guessMapping(r1.header, r1.sample), overrides: {}, account: null }, 'user');
    clock.advance(5000);
    const second = await writer.run(SaveCsvFormat, { name: 'Monzo Joint', headerSignature: sig, mapping: { ...guessMapping(r1.header, r1.sample), flipSign: true }, overrides: {}, account: { kind: 'single', accountId: 'acc-2' } }, 'user');
    expect(first.ok && second.ok && first.value.id === second.value.id).toBe(true);
    const all = await listSavedFormats(db);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ name: 'Monzo Joint', account: { kind: 'single', accountId: 'acc-2' } });
    expect(all[0]!.mapping.flipSign).toBe(true);
    expect((await db.query('SELECT flip_sign FROM csv_format'))[0]![0]).toBe(1);
    expect(await db.query("SELECT count(*) FROM audit_event WHERE entity_kind = 'csv_format'")).toEqual([[2]]);
    expect(await db.query("SELECT count(*) FROM outbox WHERE event = 'CsvFormatsChanged'")).toEqual([[2]]);
  });

  it('refuses an empty name, a long name and a signature that is not a SHA-256', async () => {
    const { writer } = await setup();
    const r1 = read(file);
    const input = { name: 'ok', headerSignature: headerSignature(r1.header, ','), mapping: guessMapping(r1.header, r1.sample), overrides: {}, account: null };
    expect(await writer.run(SaveCsvFormat, { ...input, name: '  ' }, 'user')).toMatchObject({ ok: false, code: 'FORMAT_INVALID' });
    expect(await writer.run(SaveCsvFormat, { ...input, name: 'x'.repeat(81) }, 'user')).toMatchObject({ ok: false, code: 'FORMAT_INVALID' });
    expect(await writer.run(SaveCsvFormat, { ...input, headerSignature: 'abc' }, 'user')).toMatchObject({ ok: false, code: 'FORMAT_INVALID' });
  });

  it('a damaged stored mapping is a miss, not a crash', async () => {
    const { db } = await setup();
    const r1 = read(file);
    await db.query("INSERT INTO csv_format (id, name, header_signature, mapping_json, created_at, updated_at) VALUES ('x', 'Bad', ?, '{\"a\":1}', 1, 1)", [headerSignature(r1.header, ',')]);
    await db.query("UPDATE csv_format SET account_json = '[1,2]'");
    expect(await findSavedFormat(db, r1)).not.toBeUndefined(); // parses; whatever it holds is the caller's to validate
    await expect(db.query("INSERT INTO csv_format (id, name, header_signature, mapping_json, created_at, updated_at) VALUES ('y', 'Worse', 'z', 'not json', 1, 1)")).rejects.toThrow(); // the table refuses invalid JSON
  });
});
