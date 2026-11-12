import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry } from '../testing/capture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { SubmitCapture } from '../capture/submitCapture';
import { AddAccount, openingBalanceShape } from '../ledger/accountCommands';
import { entryShape } from '../ledger/entryCommands';
import { SetSplits } from '../ledger/splits';
import { RemoveBudget, readBudgetForEdit, RestoreBudget, SaveBudget, UndoSaveBudget, type SaveBudgetInput } from './budgetCommands';
import { loadBudgetDetail } from './budgetDetail';
import { loadBudgetList } from './budgetList';

const at = (month: number, day: number) => Date.UTC(2026, month - 1, day, 9, 0, 0) - 5.5 * 3_600_000;
const NOW = Date.UTC(2026, 10, 15, 10, 0, 0); // 15 Nov, after the clock starts

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(51)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 100_000_000 }, 'user');
  if (!a.ok) throw new Error('account');
  const accountId = a.value.accountId;
  const spend = async (categoryId: string, amountMinor: number, when: number) => {
    const r = await recordEntry(writer, { kind: 'expense', amountMinor, categoryId, accountId, merchant: `M${amountMinor}`, occurredAtMs: when });
    if (!r.ok) throw new Error(r.code);
    return r.value.transactionId;
  };
  const overall: SaveBudgetInput = { scope: 'overall', categoryIds: [], accountIds: null, periodRule: 'default', targetMinor: 5_000_000, alertLevels: [75, 90, 100] };
  const save = (over: Partial<SaveBudgetInput> = {}) => writer.run(SaveBudget, { ...overall, ...over }, 'user');
  return { db, clock, writer, accountId, spend, save, overall };
}

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};
const detail = async (db: NodeSqliteDatabase, id: string, back = 0) => {
  const d = await loadBudgetDetail(db, id, back, NOW);
  if (d === null || d === 'missing') throw new Error(`no detail: ${String(d)}`);
  return d;
};

describe('budget detail and past periods (Story 4.7)', () => {
  it('shows the current period: used, left, projection, status and the entries that make it up', async () => {
    const { db, spend, save } = await setup();
    await spend('cat_food', 1_200_000, at(11, 3));
    await spend('cat_groceries', 800_000, at(11, 10));
    const id = ok(await save()).value.budgetId;
    const d = await detail(db, id);
    expect(d).toMatchObject({ periodLabel: '1–30 Nov', isCurrent: true, canGoForward: false, usedMinor: 2_000_000, targetMinor: 5_000_000 });
    expect(d.status).toMatchObject({ remainingMinor: 3_000_000, daysRemaining: 16, projectedMinor: 4_000_000 });
    expect(d.entries.map((e) => [e.localDate, e.amountMinor, e.kind])).toEqual([['2026-11-10', 800_000, 'expense'], ['2026-11-03', 1_200_000, 'expense']]);
  });

  it('an overall budget lists each category floored at zero and the amounts add up to the used figure exactly', async () => {
    const { db, writer, accountId, spend, save, clock } = await setup();
    await spend('cat_food', 1_000_000, at(11, 5));
    await spend('cat_groceries', 400_000, at(11, 6));
    const tv = await spend('cat_shopping', 900_000, at(10, 20));
    await spend('cat_shopping', 200_000, at(11, 3));
    clock.advance(1000);
    ok(await writer.run(SubmitCapture, { submissionId: 'rf', sourceKind: 'manual', refund: { originalId: tv, amountMinor: 900_000, recoveryKind: 'refund' } }, 'user'));
    void accountId;
    const d = await detail(db, ok(await save()).value.budgetId);
    expect(d.breakdown!.map((c) => [c.name, c.amountMinor])).toEqual([['Food & Drinks', 1_000_000], ['Groceries', 400_000]]);
    expect(d.breakdown!.reduce((s, c) => s + c.amountMinor, 0)).toBe(d.usedMinor);
    expect(d.usedMinor).toBe(1_400_000);
    expect(d.refundSurplusMinor).toBe(700_000); // Refunds this period: +₹7,000
    // The refund is listed as money back.
    expect(d.entries.some((e) => e.kind === 'refund' && e.amountMinor === 900_000)).toBe(true);
  });

  it('a category budget has no breakdown, and a split entry counts only its in-scope part', async () => {
    const { db, writer, spend, save } = await setup();
    const tx = await spend('cat_food', 1_000_000, at(11, 4));
    ok(await writer.run(SetSplits, { transactionId: tx, splits: [{ categoryId: 'cat_food', amountMinor: 600_000 }, { categoryId: 'cat_groceries', amountMinor: 400_000 }] }, 'user'));
    const d = await detail(db, ok(await save({ scope: 'category', categoryIds: ['cat_groceries'], periodRule: 'monthly' })).value.budgetId);
    expect(d.breakdown).toBeNull();
    expect(d.usedMinor).toBe(400_000);
    expect(d.entries).toHaveLength(1);
    expect(d.entries[0]).toMatchObject({ id: tx, amountMinor: 400_000 });
  });

  it('the period switcher goes back to October with its own used, target version, status and entries; no future periods', async () => {
    const { db, spend, save } = await setup();
    await spend('cat_food', 700_000, at(10, 12));
    await spend('cat_food', 100_000, at(11, 2));
    const id = ok(await save()).value.budgetId;
    // The first target applies from the current period: back to October has no earlier target, so the switcher stops there.
    const cur = await detail(db, id);
    expect(cur.canGoBack).toBe(false);
    // Give the budget an earlier target (a version from October), as it would have after changes over time.
    db.raw.exec(`UPDATE budget_target_version SET effective_from = '2026-10-01' WHERE budget_id = '${id}'`);
    const d = await detail(db, id);
    expect(d.canGoBack).toBe(true);
    const oct = await detail(db, id, 1);
    expect(oct).toMatchObject({ periodLabel: '1–31 Oct', isCurrent: false, canGoForward: true, usedMinor: 700_000, targetMinor: 5_000_000, nextStart: '2026-11-01' });
    expect(oct.status).toMatchObject({ daysRemaining: 0, projectedMinor: null });
    expect(oct.entries.map((e) => e.amountMinor)).toEqual([700_000]);
    expect(oct.canGoBack).toBe(false);
  });
});

describe('changing the limit keeps history (Story 4.7, BDG-007)', () => {
  async function withUsed() {
    const s = await setup();
    await s.spend('cat_food', 2_000_000, at(11, 14));
    const id = ok(await s.save()).value.budgetId;
    s.db.raw.exec(`UPDATE budget_target_version SET effective_from = '2026-10-01' WHERE budget_id = '${id}'`);
    return { ...s, id };
  }
  const versions = async (db: NodeSqliteDatabase, id: string) => (await db.query('SELECT version, target_minor, effective_from FROM budget_target_version WHERE budget_id = ? ORDER BY version', [id])).map((r) => r.map(String));

  it('Starting this period: this period shows ₹25,000 left and every past period keeps ₹50,000', async () => {
    const { db, save, id } = await withUsed();
    ok(await save({ id, targetMinor: 4_500_000, targetFrom: 'this_period' }));
    expect(await versions(db, id)).toEqual([['1', '5000000', '2026-10-01'], ['2', '4500000', '2026-11-01']]);
    expect((await detail(db, id)).status.remainingMinor).toBe(2_500_000);
    expect((await detail(db, id, 1)).targetMinor).toBe(5_000_000);
    expect((await db.query('SELECT start_date, target_minor FROM budget_period WHERE budget_id = ? ORDER BY start_date', [id])).map((r) => r.map(String))).toEqual([['2026-10-01', '5000000'], ['2026-11-01', '4500000'], ['2026-12-01', '4500000']]);
  });

  it('From next period: this period stays at ₹50,000 and ₹45,000 applies from 1 December', async () => {
    const { db, clock, save, id } = await withUsed();
    ok(await save({ id, targetMinor: 4_500_000, targetFrom: 'next_period' }));
    expect(await versions(db, id)).toEqual([['1', '5000000', '2026-10-01'], ['2', '4500000', '2026-12-01']]);
    expect((await detail(db, id)).status.remainingMinor).toBe(3_000_000);
    clock.advance(20 * 86_400_000);
    const dec = await loadBudgetDetail(db, id, 0, Date.UTC(2026, 11, 3, 10));
    expect(dec).toMatchObject({ periodLabel: '1–31 Dec', targetMinor: 4_500_000 });
    // November, now the previous period, still has its ₹50,000.
    expect(await loadBudgetDetail(db, id, 1, Date.UTC(2026, 11, 3, 10))).toMatchObject({ targetMinor: 5_000_000, usedMinor: 2_000_000 });
  });

  it('a one-off custom range has no next period; the editor learns when a change can start', async () => {
    const { db, save, id } = await withUsed();
    const e = (await readBudgetForEdit(db, id, NOW))!;
    expect([e.currentPeriodStart, e.nextPeriodStart, e.targetMinor]).toEqual(['2026-11-01', '2026-12-01', 5_000_000]);
    const custom = ok(await save({ scope: 'category', categoryIds: ['cat_food'], periodRule: 'custom', customStart: '2026-11-01', customEnd: '2026-11-30', targetMinor: 300_000 })).value.budgetId;
    expect((await readBudgetForEdit(db, custom, NOW))!.nextPeriodStart).toBeNull();
    expect(await save({ id: custom, scope: 'category', categoryIds: ['cat_food'], periodRule: 'custom', customStart: '2026-11-01', customEnd: '2026-11-30', targetMinor: 400_000, targetFrom: 'next_period' })).toMatchObject({ ok: false, code: 'NO_NEXT_PERIOD' });
    expect(Number((await db.query('SELECT COUNT(*) FROM budget_target_version WHERE budget_id = ?', [custom]))[0]![0])).toBe(1);
  });

  it('Undo of a change removes the new version and the old period figures come back', async () => {
    const { db, writer, save, id } = await withUsed();
    const r = ok(await save({ id, targetMinor: 4_500_000 }));
    ok(await writer.run(UndoSaveBudget, { budgetId: id, created: false, snapshot: r.value.snapshot! }, 'user'));
    expect((await detail(db, id)).targetMinor).toBe(5_000_000);
  });
});

describe('deleting a budget (Story 4.7)', () => {
  it('is soft: it leaves the list, entries are untouched, and Undo brings it back with its history and targets', async () => {
    const { db, writer, spend, save } = await setup();
    await spend('cat_food', 500_000, at(11, 4));
    const id = ok(await save({ scope: 'category', categoryIds: ['cat_food'], periodRule: 'monthly', targetMinor: 800_000 })).value.budgetId;
    await db.query('DELETE FROM outbox');
    const entriesBefore = Number((await db.query('SELECT COUNT(*) FROM "transaction"'))[0]![0]);
    ok(await writer.run(RemoveBudget, { budgetId: id }, 'user'));
    expect((await loadBudgetList(db, NOW))!.rows).toEqual([]);
    expect(await loadBudgetDetail(db, id, 0, NOW)).toBe('missing');
    expect(Number((await db.query('SELECT COUNT(*) FROM "transaction"'))[0]![0])).toBe(entriesBefore);
    expect(Number((await db.query("SELECT COUNT(*) FROM audit_event WHERE kind = 'RemoveBudget' AND entity_id = ?", [id]))[0]![0])).toBe(1);
    expect((await db.query('SELECT event FROM outbox')).map((r) => String(r[0]))).toContain('BudgetsChanged');
    ok(await writer.run(RestoreBudget, { budgetId: id }, 'user'));
    const list = (await loadBudgetList(db, NOW))!;
    expect(list.rows.map((r) => [r.name, r.usedMinor, r.targetMinor])).toEqual([['Food & Drinks', 500_000, 800_000]]);
  });

  it('an overall budget cannot come back while another overall budget exists, and deleting a missing budget changes nothing', async () => {
    const { writer, save } = await setup();
    const first = ok(await save()).value.budgetId;
    ok(await writer.run(RemoveBudget, { budgetId: first }, 'user'));
    ok(await save());
    expect(await writer.run(RestoreBudget, { budgetId: first }, 'user')).toMatchObject({ ok: false, code: 'OVERALL_EXISTS' });
    expect(await writer.run(RemoveBudget, { budgetId: 'nope' }, 'user')).toMatchObject({ ok: false, code: 'BUDGET_NOT_FOUND' });
  });
});
