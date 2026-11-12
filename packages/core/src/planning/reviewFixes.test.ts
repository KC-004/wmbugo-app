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
import { RemoveBudget, SaveBudget, UndoSaveBudget, type SaveBudgetInput } from './budgetCommands';
import { loadBudgetList } from './budgetList';
import { EvaluateBudgetAlerts } from './budgetAlerts';
import { ChangeTemplateTargets, CreateFiftyThirtyTwenty, loadTemplateState } from './budgetTemplate';

/** Fixes from the Epic 4 code review (chunk A). */

const ist = (month: number, day: number, hour = 9) => Date.UTC(2026, month - 1, day, hour, 0, 0) - 5.5 * 3_600_000;
const NOW = Date.UTC(2026, 10, 12, 10, 0, 0);

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(101)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 100_000_000 }, 'user');
  if (!a.ok) throw new Error('account');
  const base: SaveBudgetInput = { scope: 'category', categoryIds: ['cat_groceries'], accountIds: null, periodRule: 'monthly', targetMinor: 1_000_000, alertLevels: [75, 90, 100] };
  const save = async (over: Partial<SaveBudgetInput> = {}) => {
    const r = await writer.run(SaveBudget, { ...base, ...over }, 'user');
    if (!r.ok) throw new Error(r.code);
    return r.value;
  };
  const spend = async (amountMinor: number, at: number) => {
    const r = await recordEntry(writer, { kind: 'expense', amountMinor, categoryId: 'cat_groceries', accountId: a.value.accountId, merchant: 'X', occurredAtMs: at });
    if (!r.ok) throw new Error(r.code);
  };
  return { db, clock, writer, save, spend };
}

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};

describe('the 50/30/20 budgets are not edited or deleted one by one', () => {
  it('SaveBudget refuses a type or savings budget and changes nothing; RemoveBudget refuses it too', async () => {
    const { db, writer } = await setup();
    const ids = ok(await writer.run(CreateFiftyThirtyTwenty, { incomeMinor: 8_000_000 }, 'user')).value.budgetIds;
    const before = JSON.stringify(await db.query('SELECT id, name, scope, scope_budget_type FROM budget ORDER BY id'));
    for (const id of ids) {
      expect(await writer.run(SaveBudget, { id, scope: 'category', categoryIds: ['cat_food'], accountIds: null, periodRule: 'monthly', targetMinor: 100_000, alertLevels: [75] }, 'user')).toMatchObject({ ok: false, code: 'BUDGET_NOT_EDITABLE' });
      expect(await writer.run(RemoveBudget, { budgetId: id }, 'user')).toMatchObject({ ok: false, code: 'TEMPLATE_BUDGET' });
    }
    expect(JSON.stringify(await db.query('SELECT id, name, scope, scope_budget_type FROM budget ORDER BY id'))).toBe(before);
    expect(Number((await db.query('SELECT COUNT(*) FROM budget WHERE removed_at IS NULL'))[0]![0])).toBe(3);
  });
});

describe('Undo of a budget edit puts the mute switch back', () => {
  it('muting then undoing leaves it unmuted, and unmuting then undoing leaves it muted', async () => {
    const { db, writer, save } = await setup();
    const made = await save();
    const muted = ok(await writer.run(SaveBudget, { scope: 'category', categoryIds: ['cat_groceries'], accountIds: null, periodRule: 'monthly', targetMinor: 1_000_000, alertLevels: [75, 90, 100], id: made.budgetId, muted: true }, 'user'));
    const flag = async () => Number((await db.query('SELECT muted FROM budget WHERE id = ?', [made.budgetId]))[0]![0]);
    expect(await flag()).toBe(1);
    ok(await writer.run(UndoSaveBudget, { budgetId: made.budgetId, created: false, snapshot: muted.value.snapshot! }, 'user'));
    expect(await flag()).toBe(0);
    // And the other way round.
    const m2 = await save({ muted: true });
    const unmuted = ok(await writer.run(SaveBudget, { scope: 'category', categoryIds: ['cat_groceries'], accountIds: null, periodRule: 'monthly', targetMinor: 1_000_000, alertLevels: [75, 90, 100], id: m2.budgetId, muted: false }, 'user'));
    ok(await writer.run(UndoSaveBudget, { budgetId: m2.budgetId, created: false, snapshot: unmuted.value.snapshot! }, 'user'));
    expect(Number((await db.query('SELECT muted FROM budget WHERE id = ?', [m2.budgetId]))[0]![0])).toBe(1);
  });
});

describe('a period that starts before the first limit but contains it still has a target', () => {
  it('weekly to monthly with the same limit: the month has the limit, appears in the cache, and can alert', async () => {
    const { db, writer, save, spend } = await setup();
    const weekly = await save({ periodRule: 'weekly', targetMinor: 1_000_000 }); // first limit from the week start, 9 Nov
    expect((await db.query('SELECT effective_from FROM budget_target_version WHERE budget_id = ?', [weekly.budgetId])).map((r) => String(r[0]))).toEqual(['2026-11-09']);
    ok(await writer.run(SaveBudget, { scope: 'category', categoryIds: ['cat_groceries'], accountIds: null, periodRule: 'monthly', targetMinor: 1_000_000, alertLevels: [75, 90, 100], id: weekly.budgetId }, 'user'));
    // No new version (same limit), yet the month that began on 1 Nov has a target now.
    expect(Number((await db.query('SELECT COUNT(*) FROM budget_target_version WHERE budget_id = ?', [weekly.budgetId]))[0]![0])).toBe(1);
    expect((await db.query('SELECT start_date, target_minor FROM budget_period WHERE budget_id = ? ORDER BY start_date', [weekly.budgetId])).map((r) => [String(r[0]), Number(r[1])])).toContainEqual(['2026-11-01', 1_000_000]);
    const row = (await loadBudgetList(db, NOW))!.rows[0]!;
    expect([row.periodLabel, row.targetMinor]).toEqual(['1–30 Nov', 1_000_000]);
    await spend(800_000, ist(11, 3));
    const r = ok(await writer.run(EvaluateBudgetAlerts, {}, 'system'));
    expect(r.value.fired.map((f) => f.thresholdPct)).toEqual([75]);
  });

  it('a period that ended before the first limit still has none', async () => {
    const { db, save } = await setup();
    const made = await save();
    expect((await db.query('SELECT COUNT(*) FROM budget_period WHERE budget_id = ? AND end_date < ?', [made.budgetId, '2026-11-01']))[0]![0]).toBe(0);
  });
});

describe('the 50/30/20 income', () => {
  it('updating only the income raises BudgetsChanged so screens refresh', async () => {
    const { db, writer } = await setup();
    const ids = ok(await writer.run(CreateFiftyThirtyTwenty, { incomeMinor: 8_000_000 }, 'user')).value.budgetIds;
    await db.query('DELETE FROM outbox');
    const r = ok(await writer.run(ChangeTemplateTargets, { targets: { needsMinor: 4_000_000, wantsMinor: 2_400_000, savingsMinor: 1_600_000 }, incomeMinor: 9_000_000 }, 'user'));
    expect(r.value.changed).toBe(0);
    const events = (await db.query("SELECT payload_json FROM outbox WHERE event = 'BudgetsChanged'")).map((x) => JSON.parse(String(x[0])) as { budgetIds: string[] });
    expect(events).toHaveLength(1);
    expect([...events[0]!.budgetIds].sort()).toEqual([...ids].sort());
    expect(Number((await db.query('SELECT template_income_minor FROM budget LIMIT 1'))[0]![0])).toBe(9_000_000);
  });

  it('an unreadable stored onboarding income is no figure; the Plan tab state still loads', async () => {
    const { db } = await setup();
    db.raw.exec("INSERT INTO prompt_state (key, count, last_shown_at) VALUES ('budget_503020_yes', 1, 1)");
    db.raw.exec("INSERT INTO settings (key, value_json, version, updated_at) VALUES ('budget.rough_monthly_income_minor', 'not json', 1, 1)");
    const state = await loadTemplateState(db, NOW);
    expect(state).toMatchObject({ onboardingYes: true, onboardingIncomeMinor: null, suggestedIncomeMinor: null });
  });
});
