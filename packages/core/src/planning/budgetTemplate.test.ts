import fc from 'fast-check';
import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { recordEntry } from '../testing/capture';
import { SetUpProfile } from '../usecases/setUpProfile';
import type { BudgetOffer } from '../profile/onboarding';
import { findRegion } from '../profile/regions';
import { MarkPromptSeen } from '../profile/promptState';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from '../ledger/accountCommands';
import { entryShape } from '../ledger/entryCommands';
import { SaveBudget } from './budgetCommands';
import { loadBudgetList } from './budgetList';
import { ChangeTemplateTargets, CreateFiftyThirtyTwenty, loadTemplateState, PROMPT_503020_CARD_DISMISSED, splitIncome, TEMPLATE_503020, UndoFiftyThirtyTwenty } from './budgetTemplate';

const ist = (month: number, day: number, hour = 9) => Date.UTC(2026, month - 1, day, hour, 0, 0) - 5.5 * 3_600_000;
const NOW = Date.UTC(2026, 10, 12, 10, 0, 0);

async function setup(offer: BudgetOffer = { answer: 'skipped' }) {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(81)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: offer, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 100_000_000 }, 'user');
  if (!a.ok) throw new Error('account');
  const accountId = a.value.accountId;
  const entry = async (kind: 'expense' | 'income', categoryId: string, amountMinor: number, at: number) => {
    const r = await recordEntry(writer, { kind, amountMinor, categoryId, accountId, merchant: 'X', occurredAtMs: at });
    if (!r.ok) throw new Error(r.code);
  };
  const create = (income: number, targets?: Parameters<typeof CreateFiftyThirtyTwenty.execute>[1]['targets']) => writer.run(CreateFiftyThirtyTwenty, { incomeMinor: income, ...(targets ? { targets } : {}) }, 'user');
  return { db, clock, writer, entry, create };
}

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};

describe('splitIncome (Story 4.10)', () => {
  it('₹80,000 is 40,000 / 24,000 / 16,000', () => {
    expect(splitIncome(8_000_000)).toEqual({ needsMinor: 4_000_000, wantsMinor: 2_400_000, savingsMinor: 1_600_000 });
  });

  it('an income that does not divide exactly still adds up to the minor unit (₹80,000.01)', () => {
    const s = splitIncome(8_000_001);
    expect(s).toEqual({ needsMinor: 4_000_000, wantsMinor: 2_400_000, savingsMinor: 1_600_001 });
    expect(s.needsMinor + s.wantsMinor + s.savingsMinor).toBe(8_000_001);
  });

  it('property: the three always sum to the income exactly, none is negative, and Savings is never less than a fifth minus one unit', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9_000_000_000_000 }), (income) => {
        const s = splitIncome(income);
        return s.needsMinor + s.wantsMinor + s.savingsMinor === income && s.needsMinor >= 0 && s.wantsMinor >= 0 && s.savingsMinor >= 0 && s.savingsMinor >= Math.floor(income / 5) - 1;
      }),
    );
  });
});

describe('CreateFiftyThirtyTwenty (Story 4.10, BDG-009)', () => {
  it('writes Needs, Wants and Savings on the default period with the template and income, audit and one BudgetsChanged', async () => {
    const { db, create } = await setup();
    await db.query('DELETE FROM outbox');
    const r = ok(await create(8_000_000));
    expect(r.value.budgetIds).toHaveLength(3);
    const rows = (await db.query('SELECT name, scope, scope_budget_type, period_rule, template, template_income_minor FROM budget ORDER BY created_at, rowid')).map((x) => x.map((v) => (v === null ? null : String(v))));
    expect(rows).toEqual([
      ['Needs', 'budget_type', 'need', 'default', TEMPLATE_503020, '8000000'],
      ['Wants', 'budget_type', 'want', 'default', TEMPLATE_503020, '8000000'],
      ['Savings', 'savings', null, 'default', TEMPLATE_503020, '8000000'],
    ]);
    expect((await db.query('SELECT target_minor, effective_from FROM budget_target_version ORDER BY target_minor DESC')).map((x) => x.map(String))).toEqual([['4000000', '2026-11-01'], ['2400000', '2026-11-01'], ['1600000', '2026-11-01']]);
    expect(Number((await db.query("SELECT COUNT(*) FROM audit_event WHERE kind = 'CreateFiftyThirtyTwenty'"))[0]![0])).toBe(3);
    const events = (await db.query("SELECT payload_json FROM outbox WHERE event = 'BudgetsChanged'")).map((x) => JSON.parse(String(x[0])) as { budgetIds: string[] });
    expect(events).toHaveLength(1);
    expect(events[0]!.budgetIds).toEqual(r.value.budgetIds);
    expect(Number((await db.query('SELECT COUNT(*) FROM budget_period'))[0]![0])).toBeGreaterThanOrEqual(3);
  });

  it('edited targets are saved as typed and are not forced to add up to the income', async () => {
    const { db, create } = await setup();
    ok(await create(8_000_000, { needsMinor: 4_200_000, wantsMinor: 2_400_000, savingsMinor: 1_600_000 }));
    expect((await db.query("SELECT b.name, v.target_minor FROM budget b JOIN budget_target_version v ON v.budget_id = b.id ORDER BY b.created_at, b.rowid")).map((x) => [String(x[0]), Number(x[1])])).toEqual([['Needs', 4_200_000], ['Wants', 2_400_000], ['Savings', 1_600_000]]);
    expect(Number((await db.query('SELECT template_income_minor FROM budget LIMIT 1'))[0]![0])).toBe(8_000_000);
  });

  it('an empty or zero income, or a zero target, writes nothing', async () => {
    const { db, create } = await setup();
    expect(await create(0)).toMatchObject({ ok: false, code: 'INCOME_REQUIRED' });
    expect(await create(Number.NaN)).toMatchObject({ ok: false, code: 'INCOME_REQUIRED' });
    expect(await create(8_000_000, { needsMinor: 0, wantsMinor: 1, savingsMinor: 1 })).toMatchObject({ ok: false, code: 'AMOUNT_REQUIRED' });
    expect(Number((await db.query('SELECT COUNT(*) FROM budget'))[0]![0])).toBe(0);
  });

  it('a second set is refused while the template exists', async () => {
    const { db, create } = await setup();
    ok(await create(8_000_000));
    expect(await create(9_000_000)).toMatchObject({ ok: false, code: 'TEMPLATE_EXISTS' });
    expect(Number((await db.query('SELECT COUNT(*) FROM budget'))[0]![0])).toBe(3);
  });

  it('Undo removes the three together, and a new set can then be made', async () => {
    const { db, writer, create } = await setup();
    const r = ok(await create(8_000_000));
    ok(await writer.run(UndoFiftyThirtyTwenty, { budgetIds: r.value.budgetIds }, 'user'));
    expect((await loadBudgetList(db, NOW))!.rows).toEqual([]);
    ok(await create(8_000_000));
  });

  it('Needs counts Need categories, Wants counts Want categories, Savings counts no spending; an overall budget is listed apart and never added in', async () => {
    const { db, writer, entry, create } = await setup();
    await entry('expense', 'cat_groceries', 500_000, ist(11, 3)); // Need
    await entry('expense', 'cat_food', 200_000, ist(11, 4)); // Want
    await entry('expense', 'cat_family', 100_000, ist(11, 5)); // Not classified
    ok(await create(8_000_000));
    const overall = await writer.run(SaveBudget, { scope: 'overall', categoryIds: [], accountIds: null, periodRule: 'default', targetMinor: 5_000_000, alertLevels: [75, 90, 100] }, 'user');
    expect(overall.ok).toBe(true);
    const list = (await loadBudgetList(db, NOW))!;
    expect(list.rows.map((r) => [r.group, r.name, r.usedMinor, r.targetMinor])).toEqual([
      ['overall', 'Overall', 800_000, 5_000_000],
      ['50_30_20', 'Needs', 500_000, 4_000_000],
      ['50_30_20', 'Wants', 200_000, 2_400_000],
      ['50_30_20', 'Savings', 0, 1_600_000],
    ]);
    // A budget on the template is not marked as overlapping the overall one.
    expect(list.rows.filter((r) => r.group === '50_30_20').every((r) => !r.overlapsOverall)).toBe(true);
  });
});

describe('ChangeTemplateTargets (Edit targets)', () => {
  it('adds a version only for a target that changed, from this period', async () => {
    const { db, writer, create } = await setup();
    ok(await create(8_000_000));
    const r = ok(await writer.run(ChangeTemplateTargets, { targets: { needsMinor: 4_500_000, wantsMinor: 2_400_000, savingsMinor: 1_600_000 } }, 'user'));
    expect(r.value.changed).toBe(1);
    const state = await loadTemplateState(db, NOW);
    expect(state.targets).toEqual({ needsMinor: 4_500_000, wantsMinor: 2_400_000, savingsMinor: 1_600_000 });
    expect(await writer.run(ChangeTemplateTargets, { targets: { needsMinor: 0, wantsMinor: 1, savingsMinor: 1 } }, 'user')).toMatchObject({ ok: false, code: 'AMOUNT_REQUIRED' });
  });

  it('without a template there is nothing to edit', async () => {
    const { writer } = await setup();
    expect(await writer.run(ChangeTemplateTargets, { targets: { needsMinor: 1, wantsMinor: 1, savingsMinor: 1 } }, 'user')).toMatchObject({ ok: false, code: 'TEMPLATE_NOT_FOUND' });
  });
});

describe('the setup sheet and card (Story 4.10, FLOW-14)', () => {
  it('Yes at onboarding with ₹80,000: the card shows and the sheet is pre-filled with ₹80,000', async () => {
    const { db } = await setup({ answer: 'yes', roughMonthlyIncomeMinor: 8_000_000 });
    expect(await loadTemplateState(db, NOW)).toMatchObject({ onboardingYes: true, onboardingIncomeMinor: 8_000_000, suggestedIncomeMinor: 8_000_000, suggestionSource: 'onboarding', showSetupCard: true, exists: false });
  });

  it('the last full period\'s confirmed Salary wins over the onboarding figure', async () => {
    const { db, entry } = await setup({ answer: 'yes', roughMonthlyIncomeMinor: 8_000_000 });
    await entry('income', 'cat_in_salary', 9_500_000, ist(10, 1));
    await entry('income', 'cat_in_freelance', 1_000_000, ist(10, 5)); // not Salary
    await entry('income', 'cat_in_salary', 7_000_000, ist(11, 1)); // the current period, not a full one
    expect(await loadTemplateState(db, NOW)).toMatchObject({ suggestedIncomeMinor: 9_500_000, suggestionSource: 'salary' });
  });

  it('with no Salary and no onboarding answer the sheet starts empty and no card shows', async () => {
    const { db } = await setup({ answer: 'not-now' });
    expect(await loadTemplateState(db, NOW)).toMatchObject({ suggestedIncomeMinor: null, suggestionSource: null, showSetupCard: false, onboardingYes: false });
    const skipped = await setup();
    expect((await loadTemplateState(skipped.db, NOW)).showSetupCard).toBe(false);
  });

  it('dismissing the card is remembered and creates nothing; creating the targets also removes it', async () => {
    const { db, writer } = await setup({ answer: 'yes', roughMonthlyIncomeMinor: 8_000_000 });
    ok(await writer.run(MarkPromptSeen, { key: PROMPT_503020_CARD_DISMISSED }, 'user'));
    expect((await loadTemplateState(db, NOW)).showSetupCard).toBe(false);
    expect(Number((await db.query('SELECT COUNT(*) FROM budget'))[0]![0])).toBe(0);
    const other = await setup({ answer: 'yes', roughMonthlyIncomeMinor: 8_000_000 });
    ok(await other.create(8_000_000));
    expect(await loadTemplateState(other.db, NOW)).toMatchObject({ exists: true, showSetupCard: false, incomeMinor: 8_000_000 });
  });
});
