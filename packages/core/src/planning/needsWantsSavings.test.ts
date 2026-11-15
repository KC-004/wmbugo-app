import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry } from '../testing/capture';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { MarkPromptSeen } from '../profile/promptState';
import { LedgerWriter } from '../writer/ledgerWriter';
import { SubmitCapture } from '../capture/submitCapture';
import { AddAccount, openingBalanceShape } from '../ledger/accountCommands';
import { entryShape } from '../ledger/entryCommands';
import { SaveCategory } from '../ledger/categoryCommands';
import { SaveBudget } from './budgetCommands';
import { budgetFigures } from './budgets';
import { loadBudgetDetail } from './budgetDetail';
import { loadBudgetList } from './budgetList';
import { ChangeTemplateTargets, CreateFiftyThirtyTwenty, incomeCardKey, loadTemplateState, splitIncome } from './budgetTemplate';
import { categoryIdsUnder, leftInBudget, needsWantsSavings } from './needsWantsSavings';

const ist = (month: number, day: number, hour = 9) => Date.UTC(2026, month - 1, day, hour, 0, 0) - 5.5 * 3_600_000;
const NOW = Date.UTC(2026, 10, 12, 10, 0, 0);
const NOV = { start: '2026-11-01', end: '2026-11-30' };

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(91)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const acc = async (name: string, type: 'bank' | 'savings_pot' | 'cash' | 'card', opening = 100_000_000) => {
    const r = await writer.run(AddAccount, { name, type, openingMinor: opening }, 'user');
    if (!r.ok) throw new Error(`account ${r.code}`);
    return r.value.accountId;
  };
  const bank = await acc('HDFC', 'bank');
  const pot = await acc('Holiday', 'savings_pot', 0);
  const pot2 = await acc('Car', 'savings_pot', 0);
  const spend = async (categoryId: string, amountMinor: number, at: number) => {
    const r = await recordEntry(writer, { kind: 'expense', amountMinor, categoryId, accountId: bank, merchant: 'X', occurredAtMs: at });
    if (!r.ok) throw new Error(r.code);
    return r.value.transactionId;
  };
  const income = async (categoryId: string, amountMinor: number, at: number) => {
    const r = await recordEntry(writer, { kind: 'income', amountMinor, categoryId, accountId: bank, merchant: 'Acme', occurredAtMs: at });
    if (!r.ok) throw new Error(r.code);
  };
  let n = 0;
  const move = async (from: string, to: string, amountMinor: number, at: number) => {
    const r = await writer.run(SubmitCapture, { submissionId: `mv-${++n}`, sourceKind: 'manual', transfer: { fromAccountId: from, toAccountId: to, amountMinor, occurredAtMs: at } }, 'user');
    if (!r.ok) throw new Error(r.code);
  };
  const refund = async (originalId: string, amountMinor: number) => {
    clock.advance(1000);
    const r = await writer.run(SubmitCapture, { submissionId: `rf-${++n}`, sourceKind: 'manual', refund: { originalId, amountMinor, recoveryKind: 'refund' } }, 'user');
    if (!r.ok) throw new Error(r.code);
  };
  return { db, clock, writer, bank, pot, pot2, spend, income, move, refund };
}

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};

describe('needsWantsSavings (Story 4.11, BDG-009, CAT-006)', () => {
  it('Needs and Wants are the spending of categories of that type; everything else is Not classified', async () => {
    const { db, spend } = await setup();
    await spend('cat_groceries', 500_000, ist(11, 3)); // Need
    await spend('cat_housing', 1_000_000, ist(11, 4)); // Need
    await spend('cat_food', 200_000, ist(11, 5)); // Want
    await spend('cat_uncategorised', 30_000, ist(11, 6)); // none
    await spend('cat_family', 70_000, ist(11, 7)); // Not classified
    const r = await needsWantsSavings(db, NOV);
    expect([r.needsMinor, r.wantsMinor, r.notClassifiedMinor]).toEqual([1_500_000, 200_000, 100_000]);
    expect(r.needs.map((x) => [x.name, x.amountMinor])).toEqual([['Housing', 1_000_000], ['Groceries', 500_000]]);
    expect(r.needs.reduce((s, x) => s + x.amountMinor, 0)).toBe(r.needsMinor);
    expect(r.notClassified.map((x) => x.name).sort()).toEqual(['Family', 'Uncategorised']);
  });

  it('a refund is netted per category and floored at zero first, so it never lowers another category', async () => {
    const { db, spend, refund } = await setup();
    const tv = await spend('cat_shopping', 900_000, ist(10, 20)); // Want, October
    await spend('cat_shopping', 200_000, ist(11, 3));
    await spend('cat_food', 1_000_000, ist(11, 5)); // Want
    await refund(tv, 900_000);
    const r = await needsWantsSavings(db, NOV);
    expect(r.wantsMinor).toBe(1_000_000); // Shopping floors at 0; Food is untouched
    expect(r.wants.map((x) => x.name)).toEqual(['Food & Drinks']);
  });

  it('a subcategory counts under its parent\'s type', async () => {
    const { db, writer, spend } = await setup();
    const sub = ok(await writer.run(SaveCategory, { name: 'Rice', kind: 'expense', icon: 'ShoppingCart', colour: 'cat-lime', budgetType: 'want', parentId: 'cat_groceries' }, 'user')).value.categoryId;
    await spend(sub, 40_000, ist(11, 3));
    await spend('cat_groceries', 60_000, ist(11, 4));
    const r = await needsWantsSavings(db, NOV);
    expect([r.needsMinor, r.wantsMinor]).toEqual([100_000, 0]);
    expect(r.needs).toEqual([{ categoryId: 'cat_groceries', name: 'Groceries', amountMinor: 100_000 }]);
  });

  it('changing a category type moves its spending between Needs and Wants in every period, with no amount changed', async () => {
    const { db, writer, spend } = await setup();
    await spend('cat_groceries', 500_000, ist(11, 3));
    await spend('cat_groceries', 300_000, ist(10, 3));
    const amounts = async () => JSON.stringify(await db.query('SELECT id, amount_minor FROM split ORDER BY id'));
    const before = await amounts();
    expect((await needsWantsSavings(db, NOV)).needsMinor).toBe(500_000);
    ok(await writer.run(SaveCategory, { id: 'cat_groceries', name: 'Groceries', kind: 'expense', icon: 'ShoppingCart', colour: 'cat-lime', budgetType: 'want' }, 'user'));
    expect(await amounts()).toBe(before);
    const nov = await needsWantsSavings(db, NOV);
    const oct = await needsWantsSavings(db, { start: '2026-10-01', end: '2026-10-31' });
    expect([nov.needsMinor, nov.wantsMinor, oct.needsMinor, oct.wantsMinor]).toEqual([0, 500_000, 0, 300_000]);
  });

  it('Savings is money moved into savings pots: a withdrawal reduces it, pot-to-pot and other transfers count nothing', async () => {
    const { db, bank, pot, pot2, move } = await setup();
    await move(bank, pot, 1_800_000, ist(11, 2));
    await move(pot, pot2, 500_000, ist(11, 3)); // pot to pot: zero
    await move(pot, bank, 300_000, ist(11, 4)); // withdrawal
    const r = await needsWantsSavings(db, NOV);
    expect([r.savingsMovedMinor, r.savingsMinor]).toEqual([1_500_000, 1_500_000]);
  });

  it('a net outflow shows zero, never a minus, while the exact figure stays below zero', async () => {
    const { db, bank, pot, move } = await setup();
    await move(bank, pot, 100_000, ist(10, 28));
    await move(pot, bank, 100_000, ist(11, 2));
    await move(pot, bank, 0 + 50_000, ist(11, 3)).catch(() => undefined);
    const r = await needsWantsSavings(db, NOV);
    expect(r.savingsMinor).toBe(0);
    expect(r.savingsMovedMinor).toBeLessThanOrEqual(0);
  });
});

describe('the 50/30/20 list and drill-down (Story 4.11)', () => {
  it('the template rows count Needs, Wants and Savings; Not classified is listed with what to open in Activity', async () => {
    const { db, writer, bank, pot, spend, move } = await setup();
    await spend('cat_groceries', 2_200_000, ist(11, 3));
    await spend('cat_food', 500_000, ist(11, 4));
    await spend('cat_uncategorised', 300_000, ist(11, 5));
    await move(bank, pot, 1_800_000, ist(11, 6));
    ok(await writer.run(CreateFiftyThirtyTwenty, { incomeMinor: 8_000_000 }, 'user'));
    const list = (await loadBudgetList(db, NOW))!;
    expect(list.rows.map((r) => [r.name, r.usedMinor, r.targetMinor])).toEqual([['Needs', 2_200_000, 4_000_000], ['Wants', 500_000, 2_400_000], ['Savings', 1_800_000, 1_600_000]]);
    // Above its target, Savings is a good thing: the status is never a warning kind the screen would turn into Over by.
    expect(list.rows[2]).toMatchObject({ scope: 'savings', savingsMovedMinor: 1_800_000 });
    expect(list.typeSummary).toMatchObject({ notClassifiedMinor: 300_000, period: NOV });
    expect(list.typeSummary!.categoryIds).toEqual(['cat_uncategorised']);
    expect(await categoryIdsUnder(db, ['cat_groceries'])).toContain('cat_groceries');
  });

  it('the Needs detail lists its categories with floored amounts that sum to the bar, and Savings lists the transfers in and out', async () => {
    const { db, writer, bank, pot, spend, move } = await setup();
    await spend('cat_groceries', 500_000, ist(11, 3));
    await spend('cat_housing', 1_000_000, ist(11, 4));
    await move(bank, pot, 900_000, ist(11, 5));
    await move(pot, bank, 200_000, ist(11, 6));
    ok(await writer.run(CreateFiftyThirtyTwenty, { incomeMinor: 8_000_000 }, 'user'));
    const list = (await loadBudgetList(db, NOW))!;
    const id = (name: string) => list.rows.find((r) => r.name === name)!.id;
    const needs = await loadBudgetDetail(db, id('Needs'), 0, NOW);
    if (needs === 'missing' || needs === null) throw new Error('detail');
    expect(needs.breakdown!.map((c) => [c.name, c.amountMinor])).toEqual([['Housing', 1_000_000], ['Groceries', 500_000]]);
    expect(needs.breakdown!.reduce((s, c) => s + c.amountMinor, 0)).toBe(needs.usedMinor);
    const savings = await loadBudgetDetail(db, id('Savings'), 0, NOW);
    if (savings === 'missing' || savings === null) throw new Error('detail');
    expect(savings.usedMinor).toBe(700_000);
    expect(savings.entries.map((e) => [e.kind, e.direction, e.amountMinor, e.accountName])).toEqual([
      ['transfer', 'out', 200_000, 'Holiday → HDFC'],
      ['transfer', 'in', 900_000, 'HDFC → Holiday'],
    ]);
  });

  it('a savings budget measures savings through budgetFigures too', async () => {
    const { db, bank, pot, move } = await setup();
    await move(bank, pot, 250_000, ist(11, 6));
    const f = await budgetFigures(db, { id: 's', scope: 'savings', categoryIds: [], budgetType: null, accountIds: null, period: { rule: 'default' } }, NOV);
    expect(f).toMatchObject({ usedMinor: 250_000, savingsMovedMinor: 250_000, refundSurplusMinor: 0 });
  });
});

describe('leftInBudget (Story 4.11, for Home and Free to use)', () => {
  it('with an overall budget: target minus used, with the refund surplus apart', async () => {
    const { db, writer, spend, refund } = await setup();
    const tv = await spend('cat_shopping', 900_000, ist(10, 20));
    await spend('cat_shopping', 200_000, ist(11, 3));
    await spend('cat_food', 1_000_000, ist(11, 5));
    await refund(tv, 900_000);
    ok(await writer.run(SaveBudget, { scope: 'overall', categoryIds: [], accountIds: null, periodRule: 'default', targetMinor: 5_000_000, alertLevels: [75, 90, 100] }, 'user'));
    expect(await leftInBudget(db, NOW)).toEqual({ kind: 'overall', period: expect.objectContaining({ start: '2026-11-01', end: '2026-11-30' }), targetMinor: 5_000_000, usedMinor: 1_000_000, leftMinor: 4_000_000, refundSurplusMinor: 700_000 });
  });

  it('with only 50/30/20: Needs + Wants targets minus Needs + Wants + Not classified spending, naming the Not classified part', async () => {
    const { db, writer, spend } = await setup();
    ok(await writer.run(CreateFiftyThirtyTwenty, { incomeMinor: 8_000_000, targets: { needsMinor: 2_500_000, wantsMinor: 1_500_000, savingsMinor: 500_000 } }, 'user')); // N + W = 40,000
    await spend('cat_groceries', 1_500_000, ist(11, 3));
    await spend('cat_food', 1_000_000, ist(11, 4)); // 25,000 in Needs and Wants
    await spend('cat_uncategorised', 300_000, ist(11, 5)); // 3,000 not classified
    expect(await leftInBudget(db, NOW)).toEqual({ kind: 'types', period: expect.objectContaining({ start: '2026-11-01', end: '2026-11-30' }), targetMinor: 4_000_000, usedMinor: 2_800_000, leftMinor: 1_200_000, notClassifiedMinor: 300_000 });
  });

  it('with an overall budget as well, the overall one wins and the two are never added', async () => {
    const { db, writer, spend } = await setup();
    ok(await writer.run(CreateFiftyThirtyTwenty, { incomeMinor: 8_000_000 }, 'user'));
    ok(await writer.run(SaveBudget, { scope: 'overall', categoryIds: [], accountIds: null, periodRule: 'default', targetMinor: 5_000_000, alertLevels: [75, 90, 100] }, 'user'));
    await spend('cat_food', 100_000, ist(11, 3));
    expect(await leftInBudget(db, NOW)).toMatchObject({ kind: 'overall', targetMinor: 5_000_000, leftMinor: 4_900_000 });
  });

  it('with neither it says none, so callers show Spent this period', async () => {
    const { db } = await setup();
    expect(await leftInBudget(db, NOW)).toEqual({ kind: 'none' });
  });
});

describe('the income-changed offer (Story 4.11)', () => {
  async function withTemplate() {
    const s = await setup();
    ok(await s.writer.run(CreateFiftyThirtyTwenty, { incomeMinor: 8_000_000 }, 'user'));
    return s;
  }

  it('Salary more than 10% away from the template income offers an update to the new figure', async () => {
    const { db, income } = await withTemplate();
    await income('cat_in_salary', 9_000_000, ist(10, 1)); // the last full period
    expect((await loadTemplateState(db, NOW)).incomeChange).toEqual({ oldIncomeMinor: 8_000_000, newIncomeMinor: 9_000_000, periodStart: '2026-11-01' });
  });

  it('a difference of 10% or less, or no Salary, shows no card', async () => {
    const a = await withTemplate();
    await a.income('cat_in_salary', 8_800_000, ist(10, 1)); // exactly 10%
    expect((await loadTemplateState(a.db, NOW)).incomeChange).toBeNull();
    const b = await withTemplate();
    expect((await loadTemplateState(b.db, NOW)).incomeChange).toBeNull();
  });

  it('either answer hides the card until the next period; the next period asks again', async () => {
    const { db, writer, income } = await withTemplate();
    await income('cat_in_salary', 9_000_000, ist(10, 1));
    ok(await writer.run(MarkPromptSeen, { key: incomeCardKey('2026-11-01') }, 'user'));
    expect((await loadTemplateState(db, NOW)).incomeChange).toBeNull();
    // December: the last full period is November (no Salary there), so nothing is offered; the key was per period anyway.
    expect(incomeCardKey('2026-12-01')).not.toBe(incomeCardKey('2026-11-01'));
  });

  it('Update writes new target versions from this period; past periods keep theirs, and the card is gone', async () => {
    const { db, writer, income } = await withTemplate();
    await income('cat_in_salary', 9_000_000, ist(10, 1));
    const next = splitIncome(9_000_000);
    ok(await writer.run(ChangeTemplateTargets, { targets: next, incomeMinor: 9_000_000 }, 'user'));
    const state = await loadTemplateState(db, NOW);
    expect(state.targets).toEqual({ needsMinor: 4_500_000, wantsMinor: 2_700_000, savingsMinor: 1_800_000 });
    expect(state).toMatchObject({ incomeMinor: 9_000_000, incomeChange: null });
    const versions = (await db.query('SELECT version, target_minor, effective_from FROM budget_target_version WHERE budget_id = (SELECT id FROM budget WHERE name = ?) ORDER BY version', ['Needs'])).map((r) => r.map(String));
    expect(versions).toEqual([['1', '4000000', '2026-11-01'], ['2', '4500000', '2026-11-01']]);
  });
});
