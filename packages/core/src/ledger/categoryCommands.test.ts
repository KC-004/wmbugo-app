import fc from 'fast-check';
import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry } from '../testing/capture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from './accountCommands';
import { entryShape } from './entryCommands';
import { CATEGORY_LIST_SQL, mapCategoryRows } from './categories';
import { BulkRecategorise } from './bulk';
import { SetSplits } from './splits';
import { CATEGORY_COLOURS, parseKindInUse, MoveCategory, SaveCategory, SPENDING_BY_BUDGET_TYPE_SQL, spendingByBudgetType, validateCategoryName, type SaveCategoryInput } from './categoryCommands';

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(Date.UTC(2026, 10, 8, 10, 0, 0), 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(11)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 10_000_000 }, 'user');
  if (!a.ok) throw new Error('account');
  const cats = async () => mapCategoryRows(await db.query(CATEGORY_LIST_SQL));
  return { db, clock, writer, accountId: a.value.accountId, cats };
}

const fuel: SaveCategoryInput = { name: 'Fuel', kind: 'expense', icon: 'GasPump', colour: 'cat-olive', budgetType: 'need' };

describe('seeded categories after migration 12', () => {
  it('Family and Other read Not classified; the other seeds keep their types', async () => {
    const { cats } = await setup();
    const byName = new Map((await cats()).map((c) => [c.name, c.budgetType]));
    expect(byName.get('Family')).toBeNull();
    expect(byName.get('Other')).toBeNull();
    expect(byName.get('Uncategorised')).toBeNull();
    for (const n of ['Housing', 'Groceries', 'Bills & Utilities', 'Healthcare', 'Transport', 'Education']) expect(byName.get(n)).toBe('need');
    for (const n of ['Food & Drinks', 'Shopping', 'Entertainment', 'Travel', 'Personal Care']) expect(byName.get(n)).toBe('want');
    expect((await cats()).filter((c) => c.kind === 'expense')).toHaveLength(14);
  });
});

describe('validateCategoryName', () => {
  it('trims, collapses spaces, requires 1-30 characters', () => {
    expect(validateCategoryName('  Fuel  ')).toEqual({ ok: true, value: 'Fuel' });
    expect(validateCategoryName('   ')).toEqual({ ok: false, code: 'NAME_REQUIRED' });
    expect(validateCategoryName('x'.repeat(30)).ok).toBe(true);
    expect(validateCategoryName('x'.repeat(31))).toEqual({ ok: false, code: 'NAME_TOO_LONG' });
  });
});

describe('SaveCategory (Story 4.1)', () => {
  it('adds Fuel with an audit row and one CategoriesChanged event', async () => {
    const { db, writer, cats } = await setup();
    await db.query('DELETE FROM outbox');
    const r = await writer.run(SaveCategory, fuel, 'user');
    expect(r.ok).toBe(true);
    const row = (await cats()).find((c) => c.name === 'Fuel')!;
    expect(row).toMatchObject({ kind: 'expense', budgetType: 'need', icon: 'GasPump', colorToken: 'cat-olive', parentId: null });
    expect((await db.query("SELECT event FROM outbox")).map((x) => String(x[0]))).toEqual(['CategoriesChanged']);
    expect(Number((await db.query("SELECT COUNT(*) FROM audit_event WHERE kind = 'SaveCategory' AND entity_id = ?", [row.id]))[0]![0])).toBe(1);
  });

  it('refuses an empty name or a duplicate, ignoring case and spaces, and writes nothing', async () => {
    const { writer, cats } = await setup();
    expect(await writer.run(SaveCategory, { ...fuel, name: '  ' }, 'user')).toMatchObject({ ok: false, code: 'NAME_REQUIRED' });
    await writer.run(SaveCategory, fuel, 'user');
    const before = (await cats()).length;
    expect(await writer.run(SaveCategory, { ...fuel, name: ' fuel ' }, 'user')).toMatchObject({ ok: false, code: 'NAME_TAKEN' });
    expect((await cats()).length).toBe(before);
    // The same name in the other kind is a different category.
    expect((await writer.run(SaveCategory, { ...fuel, kind: 'income', budgetType: null }, 'user')).ok).toBe(true);
  });

  it('refuses a colour outside the 12 swatches', async () => {
    const { writer } = await setup();
    expect(CATEGORY_COLOURS).toHaveLength(12);
    expect(await writer.run(SaveCategory, { ...fuel, colour: '#ff0000' }, 'user')).toMatchObject({ ok: false, code: 'COLOUR_INVALID' });
  });

  it('a subcategory takes its parent kind, is one level deep and only under a spending parent', async () => {
    const { writer, cats } = await setup();
    const sub = await writer.run(SaveCategory, { ...fuel, parentId: 'cat_transport' }, 'user');
    expect(sub.ok).toBe(true);
    if (!sub.ok) return;
    expect((await cats()).find((c) => c.id === sub.value.categoryId)).toMatchObject({ parentId: 'cat_transport', kind: 'expense' });
    expect(await writer.run(SaveCategory, { ...fuel, name: 'Deep', parentId: sub.value.categoryId }, 'user')).toMatchObject({ ok: false, code: 'PARENT_INVALID' });
    expect(await writer.run(SaveCategory, { ...fuel, name: 'Pay', parentId: 'cat_in_salary', budgetType: null }, 'user')).toMatchObject({ ok: false, code: 'PARENT_INVALID' });
  });

  it('refuses a type on an income category and any edit of Uncategorised', async () => {
    const { writer } = await setup();
    expect(await writer.run(SaveCategory, { ...fuel, name: 'Tips', kind: 'income', budgetType: 'need' }, 'user')).toMatchObject({ ok: false, code: 'TYPE_INVALID' });
    expect(await writer.run(SaveCategory, { ...fuel, id: 'cat_uncategorised', name: 'Misc' }, 'user')).toMatchObject({ ok: false, code: 'CATEGORY_READONLY' });
    expect(await writer.run(SaveCategory, { ...fuel, id: 'nope' }, 'user')).toMatchObject({ ok: false, code: 'CATEGORY_NOT_FOUND' });
  });

  it('an edit applies by id, audits old and new, and leaves every entry untouched', async () => {
    const { db, writer, accountId } = await setup();
    const e = await recordEntry(writer, { kind: 'expense', amountMinor: 12_345, categoryId: 'cat_food', accountId, merchant: 'Cafe', occurredAtMs: Date.UTC(2026, 10, 8, 9, 0, 0) });
    expect(e.ok).toBe(true);
    const snap = async () => (await db.query('SELECT t.id, t.amount_minor, t.local_date, p.signed_amount_minor, s.category_id, s.amount_minor FROM "transaction" t JOIN posting p ON p.transaction_id = t.id JOIN split s ON s.transaction_id = t.id ORDER BY t.id')).map((r) => r.map(String).join('~'));
    const before = await snap();
    const r = await writer.run(SaveCategory, { id: 'cat_food', name: 'Eating out', kind: 'expense', icon: 'Hamburger', colour: 'cat-sky', budgetType: 'need' }, 'user');
    expect(r.ok).toBe(true);
    expect(await snap()).toEqual(before);
    const audit = JSON.parse(String((await db.query("SELECT change_json FROM audit_event WHERE kind = 'SaveCategory' AND entity_id = 'cat_food'"))[0]![0]));
    expect(audit.before).toMatchObject({ label: 'Food & Drinks', colour: 'cat-rose', type: 'want' });
    expect(audit.after).toMatchObject({ label: 'Eating out', colour: 'cat-sky', type: 'need' });
  });
});

describe('MoveCategory', () => {
  it('moves one place at a time, reports the position and refuses at the edges', async () => {
    const { writer, cats } = await setup();
    const names = async () => (await cats()).filter((c) => c.kind === 'expense' && c.parentId === null).map((c) => c.name);
    expect((await names()).slice(0, 3)).toEqual(['Food & Drinks', 'Groceries', 'Transport']);
    const r = await writer.run(MoveCategory, { categoryId: 'cat_transport', direction: 'up' }, 'user');
    expect(r).toMatchObject({ ok: true, value: { position: 2, of: 14 } });
    expect((await names()).slice(0, 3)).toEqual(['Food & Drinks', 'Transport', 'Groceries']);
    expect(await writer.run(MoveCategory, { categoryId: 'cat_food', direction: 'up' }, 'user')).toMatchObject({ ok: false, code: 'AT_EDGE' });
    expect(await writer.run(MoveCategory, { categoryId: 'cat_uncategorised', direction: 'up' }, 'user')).toMatchObject({ ok: false, code: 'CATEGORY_READONLY' });
  });

  it('subcategories stay with their parent when the parent moves', async () => {
    const { writer, cats } = await setup();
    const sub = await writer.run(SaveCategory, { ...fuel, parentId: 'cat_transport' }, 'user');
    if (!sub.ok) throw new Error('sub');
    await writer.run(MoveCategory, { categoryId: 'cat_transport', direction: 'up' }, 'user');
    const row = (await cats()).find((c) => c.id === sub.value.categoryId)!;
    expect(row.parentId).toBe('cat_transport');
  });
});

describe('spendingByBudgetType', () => {
  it('changing a category type moves its spending for every period and changes no amount (property)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer({ min: 1, max: 5_000_000 }), { minLength: 1, maxLength: 5 }), fc.constantFrom('need' as const, 'want' as const, null), async (amounts, newType) => {
        const { db, writer, accountId } = await setup();
        const dates = [Date.UTC(2026, 9, 10, 9), Date.UTC(2026, 10, 3, 9)];
        let total = 0;
        for (const [i, amountMinor] of amounts.entries()) {
          total += amountMinor;
          const e = await recordEntry(writer, { kind: 'expense', amountMinor, categoryId: 'cat_food', accountId, merchant: 'Cafe', occurredAtMs: dates[i % 2]! });
          if (!e.ok) throw new Error(e.code);
        }
        const totals = async () => spendingByBudgetType(await db.query(SPENDING_BY_BUDGET_TYPE_SQL, ['2026-10-01', '2026-11-30']));
        const snap = async () => (await db.query('SELECT t.id, t.amount_minor, p.signed_amount_minor, s.amount_minor FROM "transaction" t JOIN posting p ON p.transaction_id = t.id JOIN split s ON s.transaction_id = t.id ORDER BY t.id')).map((r) => r.map(String).join('~'));
        expect(await totals()).toEqual({ needMinor: 0, wantMinor: total, notClassifiedMinor: 0 });
        const before = await snap();
        const r = await writer.run(SaveCategory, { id: 'cat_food', name: 'Food & Drinks', kind: 'expense', icon: 'ForkKnife', colour: 'cat-rose', budgetType: newType }, 'user');
        expect(r.ok).toBe(true);
        const t = await totals();
        expect(t.needMinor + t.wantMinor + t.notClassifiedMinor).toBe(total);
        expect(newType === 'need' ? t.needMinor : newType === 'want' ? t.wantMinor : t.notClassifiedMinor).toBe(total);
        expect(await snap()).toEqual(before);
      }),
      { numRuns: 8 },
    );
  });
});

describe('Category kinds (Story 4.2)', () => {
  const freelance: SaveCategoryInput = { id: 'cat_in_freelance', name: 'Freelance', kind: 'income', icon: 'Laptop', colour: 'cat-cyan', budgetType: null };
  const at = Date.UTC(2026, 10, 8, 9, 0, 0);

  it('a Both category takes expense and income entries; the wrong kind is CATEGORY_KIND_MISMATCH and writes nothing', async () => {
    const { db, writer, accountId } = await setup();
    const rec = (kind: 'expense' | 'income', categoryId: string) => recordEntry(writer, { kind, amountMinor: 10_000, categoryId, accountId, merchant: 'X', occurredAtMs: at });
    expect(await rec('expense', 'cat_in_freelance')).toMatchObject({ ok: false, code: 'CATEGORY_KIND_MISMATCH' });
    expect(await rec('income', 'cat_food')).toMatchObject({ ok: false, code: 'CATEGORY_KIND_MISMATCH' });
    expect((await writer.run(SaveCategory, { ...freelance, kind: 'mixed' }, 'user')).ok).toBe(true);
    expect((await rec('expense', 'cat_in_freelance')).ok).toBe(true);
    expect((await rec('income', 'cat_in_freelance')).ok).toBe(true);
    expect(Number((await db.query('SELECT COUNT(*) FROM "transaction" WHERE event_type IN (\'expense\',\'income\')'))[0]![0])).toBe(2);
  });

  it('SetSplits and BulkRecategorise enforce the kind; bulk counts entries that do not fit as won\'t change', async () => {
    const { db, writer, accountId } = await setup();
    const inc = await recordEntry(writer, { kind: 'income', amountMinor: 50_000, categoryId: 'cat_in_salary', accountId, merchant: 'Acme', occurredAtMs: at });
    const exp = await recordEntry(writer, { kind: 'expense', amountMinor: 20_000, categoryId: 'cat_food', accountId, merchant: 'Cafe', occurredAtMs: at });
    if (!inc.ok || !exp.ok) throw new Error('setup');
    expect(await writer.run(SetSplits, { transactionId: inc.value.transactionId, splits: [{ categoryId: 'cat_food', amountMinor: 50_000 }] }, 'user')).toMatchObject({ ok: false, code: 'CATEGORY_KIND_MISMATCH' });
    const bulk = await writer.run(BulkRecategorise, { transactionIds: [inc.value.transactionId, exp.value.transactionId], categoryId: 'cat_transport' }, 'user');
    expect(bulk).toMatchObject({ ok: true, value: { skipped: 1 } });
    expect(String((await db.query('SELECT category_id FROM split WHERE transaction_id = ?', [inc.value.transactionId]))[0]![0])).toBe('cat_in_salary');
  });

  it('switching a Both category to one kind is blocked while entries of the other kind use it, and allowed when none do', async () => {
    const { writer, accountId } = await setup();
    await writer.run(SaveCategory, { ...freelance, kind: 'mixed' }, 'user');
    for (let i = 0; i < 3; i++) await recordEntry(writer, { kind: 'income', amountMinor: 10_000 + i, categoryId: 'cat_in_freelance', accountId, merchant: 'Client', occurredAtMs: at + i });
    const blocked = await writer.run(SaveCategory, { ...freelance, kind: 'expense' }, 'user');
    expect(blocked).toMatchObject({ ok: false, code: 'KIND_IN_USE:income:3' });
    expect(parseKindInUse('KIND_IN_USE:income:3')).toEqual({ side: 'income', count: 3 });
    // No spending entries: leaving the spending side is fine.
    expect((await writer.run(SaveCategory, { ...freelance, kind: 'income' }, 'user')).ok).toBe(true);
  });

  it('a pure spending category with spending entries cannot become income', async () => {
    const { writer, accountId } = await setup();
    await recordEntry(writer, { kind: 'expense', amountMinor: 10_000, categoryId: 'cat_travel', accountId, merchant: 'Hotel', occurredAtMs: at });
    expect(await writer.run(SaveCategory, { id: 'cat_travel', name: 'Travel', kind: 'income', icon: 'Airplane', colour: 'cat-emerald', budgetType: null }, 'user')).toMatchObject({ ok: false, code: 'KIND_IN_USE:spending:1' });
  });

  it('subcategories follow their parent kind in the same transaction', async () => {
    const { writer, cats } = await setup();
    const sub = await writer.run(SaveCategory, { name: 'Fuel', kind: 'expense', icon: 'GasPump', colour: 'cat-sky', budgetType: 'need', parentId: 'cat_transport' }, 'user');
    if (!sub.ok) throw new Error('sub');
    const t = (await cats()).find((c) => c.id === 'cat_transport')!;
    expect((await writer.run(SaveCategory, { id: t.id, name: t.name, kind: 'mixed', icon: t.icon, colour: t.colorToken, budgetType: t.budgetType }, 'user')).ok).toBe(true);
    expect((await cats()).find((c) => c.id === sub.value.categoryId)!.kind).toBe('mixed');
  });

  it('a Both category shares the name space of both kinds', async () => {
    const { writer } = await setup();
    await writer.run(SaveCategory, { ...freelance, kind: 'mixed' }, 'user');
    expect(await writer.run(SaveCategory, { name: 'freelance', kind: 'expense', icon: 'Car', colour: 'cat-sky', budgetType: null }, 'user')).toMatchObject({ ok: false, code: 'NAME_TAKEN' });
  });

  it('MoveCategory moves a Both category inside the list the user is looking at', async () => {
    const { writer, cats } = await setup();
    await writer.run(SaveCategory, { ...freelance, kind: 'mixed' }, 'user');
    const r = await writer.run(MoveCategory, { categoryId: 'cat_in_freelance', direction: 'up', segment: 'income' }, 'user');
    expect(r).toMatchObject({ ok: true, value: { position: 1, of: 6 } });
    expect((await cats()).filter((c) => c.kind !== 'expense' && c.parentId === null)[0]!.id).toBe('cat_in_freelance');
    expect(await writer.run(MoveCategory, { categoryId: 'cat_food', direction: 'up', segment: 'income' }, 'user')).toMatchObject({ ok: false, code: 'CATEGORY_NOT_FOUND' });
  });
});
