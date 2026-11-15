import {
  ACCOUNT_LIST_SQL,
  canCountTowardGoal,
  CountTowardGoal,
  goalOfTransaction,
  RemoveGoalTag,
  ChangeGoalState,
  loadGoalDetail,
  loadGoals,
  mapAccountRows,
  SaveGoal,
  SetAsideForGoal,
  TakeBackFromGoal,
  toLocalDate,
  UndoAddGoal,
  UndoGoalAllocation,
  freeToUse,
  type CurrencyCode,
  type FreeToUse,
  type GoalDetail,
  type GoalRow,
  type GoalState,
  type SaveGoalInput,
} from '@wmbugo/core';
import { getServices, systemClock } from '../../adapters/startApp';
import { readProfile } from '../../adapters/readProfile';

export interface GoalsData {
  readonly goals: readonly GoalRow[];
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly exponent: number;
  /** Active asset accounts a goal can point at, savings pots first. */
  readonly accounts: readonly GoalAccount[];
  /** Profile-local month, `YYYY-MM`: the earliest month `By` accepts. */
  readonly thisMonth: string;
}

export interface GoalAccount {
  readonly id: string;
  readonly name: string;
  readonly isPot: boolean;
}

/** What a savings transfer's detail needs: the goal it counts toward, or the goals it could. */
export interface TransferGoalState {
  readonly goal: { goalId: string; name: string } | null;
  readonly canCount: boolean;
  readonly goals: readonly { id: string; name: string }[];
}

export interface GoalDetailData {
  readonly detail: GoalDetail;
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly exponent: number;
  readonly accounts: readonly GoalAccount[];
  readonly thisMonth: string;
}

export type GoalOutcome = { ok: true } | { ok: false; code: string };
export type SaveGoalOutcome = { ok: true; value: { goalId: string; created: boolean } } | { ok: false; code: string };
export type AllocationOutcome = { ok: true; value: { allocationId: string } } | { ok: false; code: string };

/** What the goals screens need. The real one reads through core and the writer; tests pass a fake. */
export interface GoalsApi {
  load(): Promise<GoalsData | null>;
  loadDetail(id: string): Promise<GoalDetailData | 'missing' | null>;
  save(input: SaveGoalInput): Promise<SaveGoalOutcome>;
  /** Undo of adding a goal. */
  undoAdd(goalId: string): Promise<GoalOutcome>;
  setAside(goalId: string, amountMinor: number): Promise<AllocationOutcome>;
  takeBack(goalId: string, amountMinor: number): Promise<AllocationOutcome>;
  undoAllocation(allocationId: string): Promise<GoalOutcome>;
  changeState(goalId: string, to: GoalState): Promise<GoalOutcome>;
  /** Story 6.7: the goal a savings transfer counts toward, or the active goals it could. */
  forTransfer(transactionId: string): Promise<TransferGoalState>;
  countToward(transactionId: string, goalId: string): Promise<GoalOutcome>;
  removeTag(transactionId: string): Promise<GoalOutcome>;
  /** Story 6.9: what Free to use is now, so setting aside or restoring can warn when it would leave you short. */
  freeToUse?(): Promise<FreeToUse>;
}

export const GOALS_QUERY_KEY = ['goals', 'list'] as const;
export const goalDetailKey = (id: string) => ['goals', 'detail', id] as const;
export const transferGoalKey = (transactionId: string) => ['goals', 'transfer', transactionId] as const;

async function accounts() {
  const rows = mapAccountRows(await getServices().db.query(ACCOUNT_LIST_SQL)).filter((a) => a.status === 'active' && a.type !== 'card');
  return [...rows.filter((a) => a.type === 'savings_pot'), ...rows.filter((a) => a.type !== 'savings_pot')].map((a) => ({ id: a.id, name: a.name, isPot: a.type === 'savings_pot' }));
}

const run = async (r: Promise<{ ok: true } | { ok: false; code: string }>): Promise<GoalOutcome> => {
  const x = await r;
  return x.ok ? { ok: true } : { ok: false, code: x.code };
};

export const realGoalsApi: GoalsApi = {
  async load() {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return null;
    return { goals: await loadGoals(db, systemClock.nowMs()), currency: p.currency, locale: p.locale, exponent: p.exponent, accounts: await accounts(), thisMonth: await thisMonth() };
  },
  async loadDetail(id) {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return null;
    const detail = await loadGoalDetail(db, id, systemClock.nowMs());
    if (detail === 'missing') return 'missing';
    return { detail, currency: p.currency, locale: p.locale, exponent: p.exponent, accounts: await accounts(), thisMonth: await thisMonth() };
  },
  async save(input) {
    const r = await getServices().writer.run(SaveGoal, input, 'user');
    return r.ok ? { ok: true, value: r.value } : { ok: false, code: r.code };
  },
  undoAdd: (goalId) => run(getServices().writer.run(UndoAddGoal, { goalId }, 'user')),
  async setAside(goalId, amountMinor) {
    const r = await getServices().writer.run(SetAsideForGoal, { goalId, amountMinor }, 'user');
    return r.ok ? { ok: true, value: r.value } : { ok: false, code: r.code };
  },
  async takeBack(goalId, amountMinor) {
    const r = await getServices().writer.run(TakeBackFromGoal, { goalId, amountMinor }, 'user');
    return r.ok ? { ok: true, value: r.value } : { ok: false, code: r.code };
  },
  undoAllocation: (allocationId) => run(getServices().writer.run(UndoGoalAllocation, { allocationId }, 'user')),
  changeState: (goalId, to) => run(getServices().writer.run(ChangeGoalState, { goalId, to }, 'user')),
  async forTransfer(transactionId) {
    const db = getServices().db;
    const goal = await goalOfTransaction(db, transactionId);
    const canCount = goal ? false : await canCountTowardGoal(db, transactionId);
    const goals = canCount ? (await loadGoals(db)).filter((g) => g.state === 'active').map((g) => ({ id: g.id, name: g.name })) : [];
    return { goal, canCount, goals };
  },
  freeToUse: () => freeToUse(getServices().db, systemClock.nowMs()),
  countToward: (transactionId, goalId) => run(getServices().writer.run(CountTowardGoal, { transactionId, goalId }, 'user')),
  removeTag: (transactionId) => run(getServices().writer.run(RemoveGoalTag, { transactionId }, 'user')),
};

/** The month the profile is in now (`YYYY-MM`), from the profile timezone. */
async function thisMonth(): Promise<string> {
  const p = (await getServices().db.query('SELECT timezone_id FROM profile LIMIT 1'))[0];
  const d = p ? toLocalDate(systemClock.nowMs(), String(p[0])) : null;
  return d && d.ok ? d.value.slice(0, 7) : '0000-00';
}
