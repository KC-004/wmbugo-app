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
import { ArchiveCategory, MergeCategory, previewCategory, RestoreCategory, UndoMergeCategory } from '../ledger/categoryArchive';
import { SaveCategory } from '../ledger/categoryCommands';
import { parseOverallExists, SaveBudget, UndoSaveBudget, type SaveBudgetInput } from './budgetCommands';
import { loadBudgetList } from './budgetList';

const at = (month: number, day: number) => Date.UTC(2026, month - 1, day, 9, 0, 0) - 5.5 * 3_600_000;

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(Date.UTC(2026, 10, 12, 10, 0, 0), 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(41)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 100_000_000 }, 'user');
  if (!a.ok) throw new Error('account');
  const accountId = a.value.accountId;
  const spend = async (categoryId: string, amountMinor: number, when: number) => {
    const r = await recordEntry(writer, { kind: 'expense', amountMinor, categoryId, accountId, merchant: 'X', occurredAtMs: when });
    if (!r.ok) throw new Error(r.code);
  };
  const base: SaveBudgetInput = { scope: 'category', categoryIds: ['cat_groceries'], accountIds: null, periodRule: 'monthly', targetMinor: 600_000, alertLevels: [75, 90, 100] };
  const save = (over: Partial<SaveBudgetInput> = {}) => writer.run(SaveBudget, { ...base, ...over }, 'user');
  const events = async () => (await db.query('SELECT event FROM outbox ORDER BY created_at, id')).map((r) => String(r[0]));
  return { db, clock, writer, accountId, spend, save, events, base };
}

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};

describe('SaveBudget (Story 4.6)', () => {
  it('saves a ₹6,000 monthly Groceries budget with its version 1 target, an audit row and BudgetsChanged in one transaction', async () => {
    const { db, save, events } = await setup();
    await db.query('DELETE FROM outbox');
    const r = ok(await save());
    expect(r.value.created).toBe(true);
    const b = (await db.query('SELECT name, scope, period_rule, scope_category_ids, alert_rule FROM budget WHERE id = ?', [r.value.budgetId]))[0]!;
    expect(b.map(String)).toEqual(['Groceries', 'category', 'monthly', '["cat_groceries"]', '[75,90,100]']);
    expect((await db.query('SELECT version, target_minor, effective_from FROM budget_target_version WHERE budget_id = ?', [r.value.budgetId])).map((x) => x.map(String))).toEqual([['1', '600000', '2026-11-01']]);
    expect(Number((await db.query("SELECT COUNT(*) FROM audit_event WHERE kind = 'SaveBudget' AND entity_id = ?", [r.value.budgetId]))[0]![0])).toBe(1);
    expect(await events()).toContain('BudgetsChanged');
    // The derived period cache is built in the same transaction.
    expect((await db.query('SELECT start_date, end_date, target_minor FROM budget_period WHERE budget_id = ? ORDER BY start_date', [r.value.budgetId])).map((x) => x.map(String))).toEqual([['2026-11-01', '2026-11-30', '600000'], ['2026-12-01', '2026-12-31', '600000']]);
  });

  it('refuses an empty or zero limit, no category chosen, and an end date before the start, and writes nothing', async () => {
    const { db, save } = await setup();
    expect(await save({ targetMinor: 0 })).toMatchObject({ ok: false, code: 'AMOUNT_REQUIRED' });
    expect(await save({ targetMinor: Number.NaN })).toMatchObject({ ok: false, code: 'AMOUNT_REQUIRED' });
    expect(await save({ categoryIds: [] })).toMatchObject({ ok: false, code: 'CATEGORY_REQUIRED' });
    expect(await save({ periodRule: 'custom', customStart: '2026-11-15', customEnd: '2026-11-01' })).toMatchObject({ ok: false, code: 'DATE_RANGE_INVALID' });
    expect(await save({ periodRule: 'custom', customStart: '2026-02-31', customEnd: '2026-03-01' })).toMatchObject({ ok: false, code: 'DATE_INVALID' });
    expect(await save({ categoryIds: ['cat_nope'] })).toMatchObject({ ok: false, code: 'CATEGORY_NOT_FOUND' });
    expect(await save({ alertLevels: [33] })).toMatchObject({ ok: false, code: 'ALERT_INVALID' });
    expect(Number((await db.query('SELECT COUNT(*) FROM budget'))[0]![0])).toBe(0);
    expect(Number((await db.query('SELECT COUNT(*) FROM budget_target_version'))[0]![0])).toBe(0);
  });

  it('one overall budget only: a second returns OVERALL_EXISTS with the existing id and creates nothing; an overall budget follows the profile period', async () => {
    const { db, save } = await setup();
    const first = ok(await save({ scope: 'overall', categoryIds: [], periodRule: 'weekly' }));
    expect(String((await db.query('SELECT period_rule FROM budget WHERE id = ?', [first.value.budgetId]))[0]![0])).toBe('default');
    const second = await save({ scope: 'overall', categoryIds: [] });
    expect(second.ok).toBe(false);
    expect(!second.ok && parseOverallExists(second.code)).toBe(first.value.budgetId);
    expect(Number((await db.query('SELECT COUNT(*) FROM budget'))[0]![0])).toBe(1);
    // Editing the overall budget itself is fine.
    expect((await save({ id: first.value.budgetId, scope: 'overall', categoryIds: [], targetMinor: 700_000 })).ok).toBe(true);
  });

  it('editing the limit adds a version from this period; Undo puts the budget back, and Undo of a new budget removes it', async () => {
    const { db, writer, save } = await setup();
    const made = ok(await save());
    const edit = ok(await save({ id: made.value.budgetId, targetMinor: 450_000, categoryIds: ['cat_groceries', 'cat_food'] }));
    expect((await db.query('SELECT version, target_minor FROM budget_target_version WHERE budget_id = ? ORDER BY version', [made.value.budgetId])).map((x) => x.map(String))).toEqual([['1', '600000'], ['2', '450000']]);
    expect(String((await db.query('SELECT name FROM budget WHERE id = ?', [made.value.budgetId]))[0]![0])).toBe('Groceries and Food & Drinks');
    ok(await writer.run(UndoSaveBudget, { budgetId: made.value.budgetId, created: false, snapshot: edit.value.snapshot! }, 'user'));
    expect(String((await db.query('SELECT name FROM budget WHERE id = ?', [made.value.budgetId]))[0]![0])).toBe('Groceries');
    expect(Number((await db.query('SELECT COUNT(*) FROM budget_target_version WHERE budget_id = ?', [made.value.budgetId]))[0]![0])).toBe(1);
    ok(await writer.run(UndoSaveBudget, { budgetId: made.value.budgetId, created: true, snapshot: made.value.snapshot! }, 'user'));
    expect((await loadBudgetList(db, Date.UTC(2026, 10, 12, 10, 0, 0)))!.rows).toEqual([]);
  });
});

describe('the budget list (Story 4.6, SCR-14)', () => {
  it('groups Overall, 50/30/20 and Categories, labels each period, and counts the figures from the entries', async () => {
    const { db, save, spend } = await setup();
    await spend('cat_groceries', 340_000, at(11, 3));
    await spend('cat_food', 60_000, at(11, 4));
    ok(await save({ scope: 'overall', categoryIds: [], targetMinor: 5_000_000 }));
    ok(await save());
    ok(await save({ categoryIds: ['cat_food'], periodRule: 'weekly', targetMinor: 100_000 }));
    ok(await save({ categoryIds: ['cat_travel'], periodRule: 'custom', customStart: '2026-11-01', customEnd: '2026-11-15', targetMinor: 200_000 }));
    const list = (await loadBudgetList(db, Date.UTC(2026, 10, 12, 10, 0, 0)))!;
    expect(list.rows.map((r) => [r.group, r.name, r.periodLabel])).toEqual([
      ['overall', 'Overall', '1–30 Nov'],
      ['categories', 'Groceries', '1–30 Nov'],
      ['categories', 'Food & Drinks', 'Weekly · 9–15 Nov'],
      ['categories', 'Travel', 'Custom · 1–15 Nov'],
    ]);
    const by = Object.fromEntries(list.rows.map((r) => [r.name, r]));
    expect([by['Overall']!.usedMinor, by['Groceries']!.usedMinor, by['Groceries']!.targetMinor]).toEqual([400_000, 340_000, 600_000]);
    expect(by['Food & Drinks']!.usedMinor).toBe(0); // the 4 Nov entry is in an earlier week
    // A category budget next to the overall one says so; the overall one does not.
    expect([by['Overall']!.overlapsOverall, by['Groceries']!.overlapsOverall]).toEqual([false, true]);
    expect(by['Groceries']!.status).toMatchObject({ status: 'nearing', daysRemaining: 19, remainingMinor: 260_000 });
    expect(list.overallId).toBe(by['Overall']!.id);
  });

  it('is empty with no budgets', async () => {
    const { db } = await setup();
    expect(await loadBudgetList(db, Date.UTC(2026, 10, 12))).toMatchObject({ rows: [], overallId: null });
  });
});

describe('archiving or merging the only category of a budget ends it after the current period (Story 4.3 and 4.6)', () => {
  async function withFuel() {
    const s = await setup();
    const fuel = ok(await s.writer.run(SaveCategory, { name: 'Fuel', kind: 'expense', icon: 'GasPump', colour: 'cat-olive', budgetType: 'need' }, 'user')).value.categoryId;
    const made = ok(await s.save({ categoryIds: [fuel] }));
    return { ...s, fuel, budgetId: made.value.budgetId };
  }
  const endedAfter = async (db: NodeSqliteDatabase, id: string) => (await db.query('SELECT ended_after FROM budget WHERE id = ?', [id]))[0]![0];
  const now = Date.UTC(2026, 10, 12, 10, 0, 0);

  it('the preview names the budget, Archive sets its last period to the current one, it stays listed until that period ends, then drops out', async () => {
    const { db, writer, fuel, budgetId } = await withFuel();
    expect((await previewCategory(db, fuel))!.endingBudgets).toEqual(['Fuel']);
    ok(await writer.run(ArchiveCategory, { categoryId: fuel }, 'user'));
    expect(String(await endedAfter(db, budgetId))).toBe('2026-11-30');
    expect((await loadBudgetList(db, now))!.rows.map((r) => r.name)).toEqual(['Fuel']);
    expect((await loadBudgetList(db, Date.UTC(2026, 11, 1, 10)))!.rows).toEqual([]);
    // The budget row, its targets and past figures are kept.
    expect(Number((await db.query('SELECT COUNT(*) FROM budget WHERE id = ? AND removed_at IS NULL', [budgetId]))[0]![0])).toBe(1);
  });

  it('a budget with another category is not ended, and Restore runs an ended budget again', async () => {
    const { db, writer, save, fuel, budgetId } = await withFuel();
    const two = ok(await save({ categoryIds: [fuel, 'cat_food'] }));
    expect((await previewCategory(db, fuel))!.endingBudgets).toEqual(['Fuel']);
    ok(await writer.run(ArchiveCategory, { categoryId: fuel }, 'user'));
    expect(await endedAfter(db, two.value.budgetId)).toBeNull();
    expect(await endedAfter(db, budgetId)).not.toBeNull();
    ok(await writer.run(RestoreCategory, { categoryId: fuel }, 'user'));
    expect(await endedAfter(db, budgetId)).toBeNull();
  });

  it('Merge ends the budget too, and Undo of the merge brings it back', async () => {
    const { db, writer, fuel, budgetId } = await withFuel();
    const m = ok(await writer.run(MergeCategory, { fromId: fuel, intoId: 'cat_transport' }, 'user'));
    expect(String(await endedAfter(db, budgetId))).toBe('2026-11-30');
    ok(await writer.run(UndoMergeCategory, { previous: m.value.previous, archivedIds: m.value.archivedIds, targetId: m.value.targetId }, 'user'));
    expect(await endedAfter(db, budgetId)).toBeNull();
  });
});
