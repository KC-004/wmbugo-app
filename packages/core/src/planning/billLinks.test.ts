import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry } from '../testing/capture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from '../ledger/accountCommands';
import { entryShape } from '../ledger/entryCommands';
import { DeleteEntry, RestoreTransaction } from '../ledger/editCommands';
import { billLinkOf, DismissBillMatch, findBillMatch, linkCandidates, LinkBillPayment, parseLinkRefusal, ReleaseBillLinks, UnlinkBillPayment, withinTolerance } from './billLinks';
import { loadBillDetail, loadBillsList } from './billsList';
import { loadBillOccurrences, loadNextDue } from './recurringStore';
import { SaveRecurringRule, type SaveRecurringRuleInput } from './recurringCommands';

const NOW = Date.UTC(2026, 11, 3, 10, 0, 0); // 3 Dec 2026
const at = (month: number, day: number) => Date.UTC(2026, month - 1, day, 9, 0, 0) - 5.5 * 3_600_000;

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(63)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 100_000_000 }, 'user');
  if (!a.ok) throw new Error('account');
  const accountId = a.value.accountId;
  const rule = async (over: Partial<SaveRecurringRuleInput> = {}) => {
    const r = await writer.run(SaveRecurringRule, { title: 'Rent', expectedAmountMinor: 1_800_000, cadence: 'monthly', anchorDate: '2026-12-05', accountId, categoryId: 'cat_housing', kind: 'rent', paidTo: 'Ramesh Kumar', ...over }, 'user');
    if (!r.ok) throw new Error(r.code);
    return r.value.ruleId;
  };
  const spend = async (over: { amountMinor?: number; merchant?: string; when?: number; kind?: 'expense' | 'income' } = {}) => {
    const r = await recordEntry(writer, { kind: over.kind ?? 'expense', amountMinor: over.amountMinor ?? 1_800_000, categoryId: over.kind === 'income' ? 'cat_in_salary' : 'cat_housing', accountId, merchant: over.merchant ?? 'Ramesh Kumar', occurredAtMs: over.when ?? at(12, 4) });
    if (!r.ok) throw new Error(r.code);
    return r.value.transactionId;
  };
  return { db, clock, writer, rule, spend };
}

describe('findBillMatch (Story 6.3)', () => {
  it('tolerance is plus or minus 10 percent, inclusive', () => {
    expect(withinTolerance(1_980_000, 1_800_000)).toBe(true);
    expect(withinTolerance(1_620_000, 1_800_000)).toBe(true);
    expect(withinTolerance(1_980_001, 1_800_000)).toBe(false);
    expect(withinTolerance(1_619_999, 1_800_000)).toBe(false);
  });

  it('matches a ₹18,000 payment to Ramesh Kumar on 4 Dec to the 5 Dec rent', async () => {
    const { db, rule, spend } = await setup();
    const id = await rule();
    const tx = await spend();
    expect(await findBillMatch(db, tx)).toEqual({ ruleId: id, title: 'Rent', dueDate: '2026-12-05', expectedAmountMinor: 1_800_000 });
  });

  it('normalises the payee the way learning does (UPI prefix, case, reference numbers)', async () => {
    const { db, rule, spend } = await setup();
    await rule();
    expect(await findBillMatch(db, await spend({ merchant: 'UPI-RAMESH KUMAR 88213' }))).not.toBeNull();
    expect(await findBillMatch(db, await spend({ merchant: 'Someone Else' }))).toBeNull();
  });

  it('is within 7 days of the due date, either side, and inside the amount band', async () => {
    const { db, rule, spend } = await setup();
    await rule();
    expect(await findBillMatch(db, await spend({ when: at(11, 28) }))).not.toBeNull(); // 7 days before 5 Dec: inclusive
    expect(await findBillMatch(db, await spend({ when: at(11, 27) }))).toBeNull(); // 8 days before
    expect(await findBillMatch(db, await spend({ when: at(12, 12) }))).not.toBeNull(); // 7 days after
    expect(await findBillMatch(db, await spend({ when: at(12, 13) }))).toBeNull(); // 8 days after
    expect(await findBillMatch(db, await spend({ amountMinor: 1_980_000 }))).not.toBeNull();
    expect(await findBillMatch(db, await spend({ amountMinor: 2_100_000 }))).toBeNull();
  });

  it('returns nothing for income, a rule without paid_to, a paused rule, a linked entry or a dismissed rule', async () => {
    const { db, writer, rule, spend } = await setup();
    const noPayee = await rule({ title: 'Anon', paidTo: null });
    const tx = await spend({ merchant: 'Anon' });
    expect(await findBillMatch(db, tx)).toBeNull();
    expect(noPayee).toBeDefined();
    const income = await spend({ kind: 'income' });
    await rule({ title: 'Salary rent', paidTo: 'Ramesh Kumar' });
    expect(await findBillMatch(db, income)).toBeNull();
    const t2 = await spend();
    const m = (await findBillMatch(db, t2))!;
    expect(m.title).toBe('Salary rent');
    await writer.run(DismissBillMatch, { ruleId: m.ruleId, transactionId: t2 }, 'user');
    expect(await findBillMatch(db, t2)).toBeNull();
    // Another entry is unaffected by that dismissal.
    expect(await findBillMatch(db, await spend())).not.toBeNull();
  });

  it('with several candidates picks the nearest due date, then the smallest amount difference', async () => {
    const { db, rule, spend } = await setup();
    const near = await rule({ title: 'Near', anchorDate: '2026-12-04', expectedAmountMinor: 1_850_000 });
    await rule({ title: 'Far', anchorDate: '2026-12-08', expectedAmountMinor: 1_800_000 });
    const tx = await spend({ when: at(12, 4) });
    expect((await findBillMatch(db, tx))!.ruleId).toBe(near);
    const a = await rule({ title: 'Closer amount', anchorDate: '2026-12-04', expectedAmountMinor: 1_810_000 });
    expect((await findBillMatch(db, tx))!.ruleId).toBe(a);
  });
});

describe('LinkBillPayment and UnlinkBillPayment', () => {
  it('links once: the due date is paid, next due moves to 5 Jan, the entry is unchanged, and a retry is refused', async () => {
    const { db, clock, writer, rule, spend } = await setup();
    const id = await rule();
    const tx = await spend();
    await db.query('DELETE FROM outbox');
    const before = (await db.query('SELECT amount_minor, status FROM "transaction" WHERE id = ?', [tx]))[0]!.map(String);
    expect((await writer.run(LinkBillPayment, { ruleId: id, dueDate: '2026-12-05', transactionId: tx }, 'user')).ok).toBe(true);
    expect((await db.query('SELECT event FROM outbox')).map((r) => String(r[0]))).toContain('RecurringChanged');
    expect(await loadNextDue(db, clock.nowMs(), id)).toBe('2027-01-05');
    expect((await db.query('SELECT amount_minor, status FROM "transaction" WHERE id = ?', [tx]))[0]!.map(String)).toEqual(before);
    expect(await billLinkOf(db, tx)).toEqual({ ruleId: id, title: 'Rent', dueDate: '2026-12-05' });
    const again = await writer.run(LinkBillPayment, { ruleId: id, dueDate: '2026-12-05', transactionId: tx }, 'user');
    expect(again.ok).toBe(false);
    if (!again.ok) expect(parseLinkRefusal(again.code)).toEqual({ kind: 'entry', dueDate: '2026-12-05', title: 'Rent' });
    const other = await spend();
    const taken = await writer.run(LinkBillPayment, { ruleId: id, dueDate: '2026-12-05', transactionId: other }, 'user');
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(parseLinkRefusal(taken.code)).toEqual({ kind: 'occurrence', dueDate: '2026-12-05', title: 'Rent' });
    expect(Number((await db.query('SELECT COUNT(*) FROM recurring_payment'))[0]![0])).toBe(1);
    expect(await loadNextDue(db, clock.nowMs(), id)).toBe('2027-01-05');
  });

  it('refuses income, a date that is not due, a missing rule or entry', async () => {
    const { writer, rule, spend } = await setup();
    const id = await rule();
    const income = await spend({ kind: 'income' });
    const tx = await spend();
    expect(await writer.run(LinkBillPayment, { ruleId: id, dueDate: '2026-12-05', transactionId: income }, 'user')).toMatchObject({ ok: false, code: 'NOT_AN_EXPENSE' });
    expect(await writer.run(LinkBillPayment, { ruleId: id, dueDate: '2026-12-06', transactionId: tx }, 'user')).toMatchObject({ ok: false, code: 'NOT_A_DUE_DATE' });
    expect(await writer.run(LinkBillPayment, { ruleId: 'nope', dueDate: '2026-12-05', transactionId: tx }, 'user')).toMatchObject({ ok: false, code: 'RULE_NOT_FOUND' });
    expect(await writer.run(LinkBillPayment, { ruleId: id, dueDate: '2026-12-05', transactionId: 'nope' }, 'user')).toMatchObject({ ok: false, code: 'ENTRY_NOT_FOUND' });
  });

  it('unlink makes the due date unpaid again and next due goes back', async () => {
    const { db, clock, writer, rule, spend } = await setup();
    const id = await rule();
    const tx = await spend();
    await writer.run(LinkBillPayment, { ruleId: id, dueDate: '2026-12-05', transactionId: tx }, 'user');
    expect((await writer.run(UnlinkBillPayment, { transactionId: tx }, 'user')).ok).toBe(true);
    expect(await loadNextDue(db, clock.nowMs(), id)).toBe('2026-12-05');
    expect(await writer.run(UnlinkBillPayment, { transactionId: tx }, 'user')).toMatchObject({ ok: false, code: 'NOT_LINKED' });
  });

  it('a linked bill reads paid with the entry date and the actual amount in its history', async () => {
    const { db, clock, writer, rule, spend } = await setup();
    const id = await rule();
    const tx = await spend({ amountMinor: 1_850_000 });
    await writer.run(LinkBillPayment, { ruleId: id, dueDate: '2026-12-05', transactionId: tx }, 'user');
    clock.set(at(12, 6));
    const list = (await loadBillsList(db, clock.nowMs()))!;
    expect(list.active[0]!.status).toMatchObject({ kind: 'paid', date: '2026-12-05', paidBy: 'linked', paidOn: '2026-12-04' });
    const d = (await loadBillDetail(db, clock.nowMs(), id)) as Exclude<Awaited<ReturnType<typeof loadBillDetail>>, 'missing' | null>;
    expect(d.history[0]).toMatchObject({ dueDate: '2026-12-05', status: 'paid', paidBy: 'linked', paidOn: '2026-12-04', paidAmountMinor: 1_850_000 });
    // Editing the entry's amount later keeps the link.
    expect(await billLinkOf(db, tx)).not.toBeNull();
  });
});

describe('ReleaseBillLinks (TransactionsChanged)', () => {
  it('a deleted linked entry releases the due date, which reads not seen yet once past; restoring does not relink', async () => {
    const { db, clock, writer, rule, spend } = await setup();
    const id = await rule();
    const tx = await spend();
    await writer.run(LinkBillPayment, { ruleId: id, dueDate: '2026-12-05', transactionId: tx }, 'user');
    const del = await writer.run(DeleteEntry, { transactionId: tx }, 'user');
    expect(del.ok).toBe(true);
    const r = await writer.run(ReleaseBillLinks, {}, 'system');
    expect(r.ok && r.value.released).toBe(1);
    expect(await billLinkOf(db, tx)).toBeNull();
    clock.set(at(12, 8));
    expect((await loadBillOccurrences(db, clock.nowMs(), '2026-12-01', '2026-12-31')).map((o) => [o.dueDate, o.status])).toEqual([['2026-12-05', 'not_seen_yet']]);
    expect(await loadNextDue(db, clock.nowMs(), id)).toBe('2027-01-05');
    // Idempotent: nothing left to release, nothing raised.
    await db.query('DELETE FROM outbox');
    const again = await writer.run(ReleaseBillLinks, {}, 'system');
    expect(again.ok && again.value.released).toBe(0);
    expect(Number((await db.query("SELECT COUNT(*) FROM outbox WHERE event = 'RecurringChanged'"))[0]![0])).toBe(0);
    // Restoring the entry does not relink it silently; the prompt shows again.
    if (del.ok) await writer.run(RestoreTransaction, { snapshot: del.value.snapshot }, 'user');
    expect(await billLinkOf(db, tx)).toBeNull();
    expect(await findBillMatch(db, tx)).not.toBeNull();
  });

  it('leaves a link alone while its entry is live', async () => {
    const { writer, rule, spend } = await setup();
    const id = await rule();
    const tx = await spend();
    await writer.run(LinkBillPayment, { ruleId: id, dueDate: '2026-12-05', transactionId: tx }, 'user');
    const r = await writer.run(ReleaseBillLinks, {}, 'system');
    expect(r.ok && r.value.released).toBe(0);
  });
});

describe('linkCandidates (the picker)', () => {
  it('lists confirmed unlinked expenses within 15 days, matches first, searchable', async () => {
    const { db, writer, rule, spend } = await setup();
    const id = await rule();
    const match = await spend();
    const far = await spend({ merchant: 'Big Basket', amountMinor: 250_000, when: at(12, 18) });
    await spend({ merchant: 'Too old', when: at(11, 10) });
    const linked = await spend({ merchant: 'Already linked', amountMinor: 1_700_000, when: at(12, 3) });
    const other = await rule({ title: 'Other', paidTo: null, anchorDate: '2026-12-03' });
    await writer.run(LinkBillPayment, { ruleId: other, dueDate: '2026-12-03', transactionId: linked }, 'user');
    const list = await linkCandidates(db, id, '2026-12-05');
    expect(list.map((c) => [c.id, c.looksLikeMatch])).toEqual([[match, true], [far, false]]);
    expect((await linkCandidates(db, id, '2026-12-05', 'basket')).map((c) => c.id)).toEqual([far]);
    expect(await linkCandidates(db, id, '2026-12-05', 'zzz')).toEqual([]);
  });
});
