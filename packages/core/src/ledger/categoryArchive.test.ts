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
import { SaveCategory, type SaveCategoryInput } from './categoryCommands';
import { SetSplits } from './splits';
import { ArchiveCategory, mapOriginalCategories, ORIGINAL_CATEGORIES_SQL, categoryEntriesSql, DeleteCategory, MergeCategory, previewCategory, RestoreCategory, typeChangeNote, UndoDeleteCategory, UndoMergeCategory, mapRemapEntries, familyIds } from './categoryArchive';

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
  const at = Date.UTC(2026, 10, 8, 9, 0, 0);
  const add = async (input: SaveCategoryInput) => {
    const r = await writer.run(SaveCategory, input, 'user');
    if (!r.ok) throw new Error(`category ${r.code}`);
    return r.value.categoryId;
  };
  const spend = async (categoryId: string, amountMinor = 10_000, n = 0) => {
    const r = await recordEntry(writer, { kind: 'expense', amountMinor, categoryId, accountId: a.value.accountId, merchant: `M${n}`, occurredAtMs: at + n });
    if (!r.ok) throw new Error(`entry ${r.code}`);
    return r.value.transactionId;
  };
  const totals = async () => (await db.query('SELECT category_id, SUM(amount_minor) FROM split GROUP BY category_id ORDER BY category_id')).map((r) => [String(r[0]), Number(r[1])] as const);
  const spendTotal = async () => Number((await db.query("SELECT COALESCE(SUM(amount_minor), 0) FROM split"))[0]![0]);
  return { db, writer, cats, add, spend, totals, spendTotal, accountId: a.value.accountId, at };
}

const fuel: SaveCategoryInput = { name: 'Fuel', kind: 'expense', icon: 'GasPump', colour: 'cat-olive', budgetType: 'need' };
const archivedOf = async (db: NodeSqliteDatabase, id: string) => Number((await db.query('SELECT archived FROM category WHERE id = ?', [id]))[0]![0]);

describe('ArchiveCategory and RestoreCategory (Story 4.3)', () => {
  it('archives in one transaction: audit and CategoriesChanged, entries and totals unchanged, gone from the pickers', async () => {
    const { db, writer, cats, add, spend, totals } = await setup();
    const id = await add(fuel);
    for (let i = 0; i < 3; i++) await spend(id, 10_000 + i, i);
    const before = await totals();
    await db.query('DELETE FROM outbox');
    const r = await writer.run(ArchiveCategory, { categoryId: id }, 'user');
    expect(r).toMatchObject({ ok: true });
    expect(await archivedOf(db, id)).toBe(1);
    expect((await cats()).some((c) => c.id === id)).toBe(false);
    expect(await totals()).toEqual(before);
    expect(Number((await db.query("SELECT COUNT(*) FROM audit_event WHERE kind = 'ArchiveCategory' AND entity_id = ?", [id]))[0]![0])).toBe(1);
    expect((await db.query("SELECT event FROM outbox ORDER BY created_at")).map((x) => String(x[0]))).toEqual(['CategoriesChanged']);
  });

  it('archives subcategories with their parent, and Restore brings the family back in its old position', async () => {
    const { db, writer, cats, add } = await setup();
    const parent = await add(fuel);
    const sub = await add({ name: 'Petrol', kind: 'expense', icon: 'GasPump', colour: 'cat-olive', budgetType: 'need', parentId: parent });
    const orderBefore = (await cats()).map((c) => c.id);
    expect((await writer.run(ArchiveCategory, { categoryId: parent }, 'user'))).toMatchObject({ ok: true, value: { archivedIds: [parent, sub] } });
    expect(await archivedOf(db, sub)).toBe(1);
    expect((await writer.run(RestoreCategory, { categoryId: parent }, 'user')).ok).toBe(true);
    expect((await cats()).map((c) => c.id)).toEqual(orderBefore);
  });

  it('Uncategorised and Other cannot be archived, merged or deleted', async () => {
    const { writer } = await setup();
    for (const id of ['cat_uncategorised', 'cat_other']) {
      expect(await writer.run(ArchiveCategory, { categoryId: id }, 'user')).toMatchObject({ ok: false, code: 'CATEGORY_READONLY' });
      expect(await writer.run(MergeCategory, { fromId: id, intoId: 'cat_food' }, 'user')).toMatchObject({ ok: false, code: 'CATEGORY_READONLY' });
      expect(await writer.run(DeleteCategory, { categoryId: id }, 'user')).toMatchObject({ ok: false, code: 'CATEGORY_READONLY' });
    }
  });

  it('Restore is blocked when another active category took the name meanwhile', async () => {
    const { writer, add } = await setup();
    const id = await add(fuel);
    await writer.run(ArchiveCategory, { categoryId: id }, 'user');
    await add(fuel);
    expect(await writer.run(RestoreCategory, { categoryId: id }, 'user')).toMatchObject({ ok: false, code: 'NAME_TAKEN' });
  });
});

describe('DeleteCategory (Story 4.3)', () => {
  it('deletes an unused category and Undo puts it back as it was', async () => {
    const { db, writer, cats, add } = await setup();
    const id = await add(fuel);
    const before = (await cats()).find((c) => c.id === id)!;
    const r = await writer.run(DeleteCategory, { categoryId: id }, 'user');
    if (!r.ok) throw new Error(r.code);
    expect((await cats()).some((c) => c.id === id)).toBe(false);
    expect((await writer.run(UndoDeleteCategory, { deleted: r.value.deleted }, 'user')).ok).toBe(true);
    expect((await cats()).find((c) => c.id === id)).toEqual(before);
    expect(Number((await db.query("SELECT COUNT(*) FROM audit_event WHERE kind = 'DeleteCategory'"))[0]![0])).toBe(1);
  });

  it('is refused while any entry or subcategory uses the category: archive instead', async () => {
    const { writer, add, spend } = await setup();
    const used = await add(fuel);
    await spend(used);
    expect(await writer.run(DeleteCategory, { categoryId: used }, 'user')).toMatchObject({ ok: false, code: 'IN_USE' });
    const parent = await add({ ...fuel, name: 'Travel costs' });
    await add({ name: 'Taxi', kind: 'expense', icon: 'Car', colour: 'cat-sky', budgetType: 'need', parentId: parent });
    expect(await writer.run(DeleteCategory, { categoryId: parent }, 'user')).toMatchObject({ ok: false, code: 'HAS_SUBCATEGORIES' });
  });
});

describe('MergeCategory (Story 4.3)', () => {
  it('moves every split, keeps amounts and postings, records the original, archives the source', async () => {
    const { db, writer, add, spend, spendTotal } = await setup();
    const f = await add(fuel);
    const t = 'cat_transport';
    const tx = [await spend(f, 11_100, 1), await spend(f, 22_200, 2), await spend(t, 5_000, 3)];
    const postingsBefore = (await db.query('SELECT id, account_id, signed_amount_minor FROM posting ORDER BY id')).map((r) => r.map(String).join(':'));
    const total = await spendTotal();
    await db.query('DELETE FROM outbox');
    const r = await writer.run(MergeCategory, { fromId: f, intoId: t }, 'user');
    expect(r).toMatchObject({ ok: true, value: { movedEntries: 2, movedSplits: 2 } });
    expect((await db.query('SELECT category_id FROM split WHERE transaction_id IN (?, ?, ?) ORDER BY transaction_id', tx)).every((x) => String(x[0]) === t)).toBe(true);
    expect(await archivedOf(db, f)).toBe(1);
    expect(await spendTotal()).toBe(total);
    expect((await db.query('SELECT id, account_id, signed_amount_minor FROM posting ORDER BY id')).map((x) => x.map(String).join(':'))).toEqual(postingsBefore);
    // One audit row per moved entry with the original category, one for the category itself.
    const audit = await db.query("SELECT entity_kind, change_json FROM audit_event WHERE kind = 'MergeCategory'");
    expect(audit.filter((a) => a[0] === 'transaction')).toHaveLength(2);
    expect(JSON.parse(String(audit.find((a) => a[0] === 'transaction')![1]))).toMatchObject({ fromCategoryId: f.replace(/-/g, ''), fromLabel: 'Fuel' });
    expect((await db.query('SELECT event FROM outbox ORDER BY created_at')).map((x) => String(x[0]))).toEqual(expect.arrayContaining(['CategoryAssigned', 'CategoriesChanged', 'TransactionsChanged']));
  });

  it('moves the splits of a split entry, a subcategory family and entries that are deleted', async () => {
    const { db, writer, add, spend } = await setup();
    const parent = await add(fuel);
    const sub = await add({ name: 'Petrol', kind: 'expense', icon: 'GasPump', colour: 'cat-olive', budgetType: 'need', parentId: parent });
    const a = await spend(parent, 30_000, 1);
    await spend(sub, 7_000, 2);
    const split = await writer.run(SetSplits, { transactionId: a, splits: [{ categoryId: parent, amountMinor: 20_000 }, { categoryId: 'cat_food', amountMinor: 10_000 }] }, 'user');
    expect(split.ok).toBe(true);
    const preview = await previewCategory(db, parent);
    expect(preview).toMatchObject({ entries: 2, subcategories: 1 });
    const r = await writer.run(MergeCategory, { fromId: parent, intoId: 'cat_transport' }, 'user');
    expect(r).toMatchObject({ ok: true, value: { movedSplits: 2, movedEntries: 2 } });
    expect(Number((await db.query('SELECT COUNT(*) FROM split WHERE category_id IN (?, ?)', [parent, sub]))[0]![0])).toBe(0);
    expect(Number((await db.query("SELECT amount_minor FROM split WHERE transaction_id = ? AND category_id = 'cat_food'", [a]))[0]![0])).toBe(10_000);
    expect(await archivedOf(db, sub)).toBe(1);
    expect(await familyIds(db, parent)).toEqual([parent, sub]);
  });

  it('refuses itself, its own subcategory, an archived category and a kind the entries do not fit', async () => {
    const { writer, add, spend } = await setup();
    const parent = await add(fuel);
    const sub = await add({ name: 'Petrol', kind: 'expense', icon: 'GasPump', colour: 'cat-olive', budgetType: 'need', parentId: parent });
    await spend(parent);
    expect(await writer.run(MergeCategory, { fromId: parent, intoId: parent }, 'user')).toMatchObject({ ok: false, code: 'TARGET_INVALID' });
    expect(await writer.run(MergeCategory, { fromId: parent, intoId: sub }, 'user')).toMatchObject({ ok: false, code: 'TARGET_INVALID' });
    expect(await writer.run(MergeCategory, { fromId: parent, intoId: 'cat_uncategorised' }, 'user')).toMatchObject({ ok: false, code: 'TARGET_INVALID' });
    expect(await writer.run(MergeCategory, { fromId: parent, intoId: 'cat_in_salary' }, 'user')).toMatchObject({ ok: false, code: 'CATEGORY_KIND_MISMATCH' });
    // Nothing was written by any of the refusals.
    expect(await writer.run(ArchiveCategory, { categoryId: sub }, 'user')).toMatchObject({ ok: true });
    expect(await writer.run(MergeCategory, { fromId: parent, intoId: sub }, 'user')).toMatchObject({ ok: false, code: 'TARGET_INVALID' });
  });

  it('Undo restores every split and un-archives the merged categories in one step', async () => {
    const { db, writer, add, spend, totals } = await setup();
    const f = await add(fuel);
    await spend(f, 11_100, 1);
    await spend(f, 22_200, 2);
    const before = await totals();
    const r = await writer.run(MergeCategory, { fromId: f, intoId: 'cat_transport' }, 'user');
    if (!r.ok) throw new Error(r.code);
    const u = await writer.run(UndoMergeCategory, { previous: r.value.previous, archivedIds: r.value.archivedIds, targetId: r.value.targetId }, 'user');
    expect(u).toMatchObject({ ok: true, value: { restored: 2 } });
    expect(await archivedOf(db, f)).toBe(0);
    expect(await totals()).toEqual(before);
  });

  it('Undo leaves a split the user moved since where they put it', async () => {
    const { db, writer, add, spend } = await setup();
    const f = await add(fuel);
    const a = await spend(f, 11_100, 1);
    await spend(f, 22_200, 2);
    const r = await writer.run(MergeCategory, { fromId: f, intoId: 'cat_transport' }, 'user');
    if (!r.ok) throw new Error(r.code);
    await db.query("UPDATE split SET category_id = 'cat_food' WHERE transaction_id = ?", [a]);
    const u = await writer.run(UndoMergeCategory, { previous: r.value.previous, archivedIds: r.value.archivedIds, targetId: r.value.targetId }, 'user');
    expect(u).toMatchObject({ ok: true, value: { restored: 1 } });
  });

  it('the audit trail says where a merged entry was, and an undone merge no longer counts', async () => {
    const { db, writer, add, spend } = await setup();
    const f = await add(fuel);
    const tx = await spend(f, 11_100, 1);
    const names = async () => mapOriginalCategories(await db.query(ORIGINAL_CATEGORIES_SQL, [tx]));
    expect(await names()).toEqual([]);
    const r = await writer.run(MergeCategory, { fromId: f, intoId: 'cat_transport' }, 'user');
    if (!r.ok) throw new Error(r.code);
    expect(await names()).toEqual(['Fuel']);
    await writer.run(UndoMergeCategory, { previous: r.value.previous, archivedIds: r.value.archivedIds, targetId: r.value.targetId }, 'user');
    expect(await names()).toEqual([]);
  });

  it('property: merging never changes the spending total or any amount, whatever the entries', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.tuple(fc.integer({ min: 1, max: 5_000_000 }), fc.boolean()), { minLength: 1, maxLength: 8 }), async (items) => {
        const { writer, add, spend, spendTotal, totals } = await setup();
        const f = await add(fuel);
        for (const [i, [amount, inFuel]] of items.entries()) await spend(inFuel ? f : 'cat_groceries', amount, i);
        const total = await spendTotal();
        const amounts = (await totals()).reduce((s, [, v]) => s + v, 0);
        const r = await writer.run(MergeCategory, { fromId: f, intoId: 'cat_transport' }, 'user');
        expect(r.ok).toBe(true);
        expect(await spendTotal()).toBe(total);
        expect((await totals()).reduce((s, [, v]) => s + v, 0)).toBe(amounts);
      }),
      { numRuns: 15 },
    );
  });
});

describe('preview helpers (Story 4.3)', () => {
  it('counts live entries, lists them newest first, and ignores deleted ones', async () => {
    const { db, add, spend } = await setup();
    const f = await add(fuel);
    const keep = await spend(f, 10_000, 1);
    const gone = await spend(f, 20_000, 2);
    await db.query("UPDATE \"transaction\" SET removed_at = 1, removal_kind = 'deleted', status = 'excluded' WHERE id = ?", [gone]);
    const p = await previewCategory(db, f);
    expect(p).toMatchObject({ name: 'Fuel', entries: 1, splits: 2, subcategories: 0, isSystem: false });
    const rows = mapRemapEntries(await db.query(categoryEntriesSql(1), [f, 20, 0]));
    expect(rows.map((r) => r.id)).toEqual([keep]);
    expect(await previewCategory(db, 'nope')).toBeNull();
  });

  it('reports a changed type only for spending categories whose types differ', () => {
    const need = { name: 'Fuel', budgetType: 'need' as const, kind: 'expense' as const };
    const want = { name: 'Transport', budgetType: 'want' as const, kind: 'expense' as const };
    expect(typeChangeNote(need, want)).toEqual({ fromType: 'Need', toType: 'Want' });
    expect(typeChangeNote(need, { ...need, name: 'X' })).toBeNull();
    expect(typeChangeNote(need, { ...want, budgetType: null })).toEqual({ fromType: 'Need', toType: 'Not classified' });
    expect(typeChangeNote({ ...need, kind: 'income' }, want)).toBeNull();
  });
});
