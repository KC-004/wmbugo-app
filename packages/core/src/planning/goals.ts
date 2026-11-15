import { err, ok } from '../shared/result';
import { toLocalDate } from '../shared/clock';
import { readPaydayRule } from '../profile/paydayChange';
import { CATEGORY_COLOURS } from '../ledger/categoryCommands';
import type { UseCase, WriterContext } from '../writer/ledgerWriter';
import type { Querier } from './budgets';

/**
 * Savings goals (Story 6.6, GOAL-001/002/004). A goal is a plan: naming one or setting money aside for it moves no money
 * and changes no balance, spending or budget figure. Setting aside only stops that money counting as free to use (Story 6.9).
 * Every allocation is kept and shown whatever happens to the goal, so its history is never lost.
 */

export type GoalState = 'active' | 'paused' | 'completed' | 'archived';
export type AllocationKind = 'set_aside' | 'taken_back' | 'moved';

export interface GoalRow {
  readonly id: string;
  readonly name: string;
  readonly targetMinor: number;
  /** The first day of the month it is by, or null. */
  readonly dueDate: string | null;
  readonly icon: string;
  readonly color: string;
  readonly accountId: string | null;
  readonly accountName: string | null;
  readonly state: GoalState;
  /** Set aside minus taken back: money that stays in the account but is promised to this goal. */
  readonly setAsideMinor: number;
  /** Money moved into a savings pot for this goal (Story 6.7). */
  readonly movedMinor: number;
  /** What the goal has: set aside held plus moved. */
  readonly contributedMinor: number;
  /** The target minus contributed, never below zero. */
  readonly remainingMinor: number;
  readonly funded: boolean;
}

export interface GoalAllocationRow {
  readonly id: string;
  readonly kind: AllocationKind;
  readonly amountMinor: number;
  readonly transactionId: string | null;
  readonly localDate: string;
  readonly createdAt: number;
}

export const GOALS_SQL =
  'SELECT g.id, g.name, g.target_minor, g.due_date, g.icon, g.color, g.account_id, a.name, g.state, ' +
  "COALESCE((SELECT SUM(CASE WHEN x.kind = 'set_aside' THEN x.amount_minor WHEN x.kind = 'taken_back' THEN -x.amount_minor ELSE 0 END) FROM goal_allocation x WHERE x.goal_id = g.id), 0), " +
  "COALESCE((SELECT SUM(x.amount_minor) FROM goal_allocation x WHERE x.goal_id = g.id AND x.kind = 'moved'), 0) " +
  'FROM goal g LEFT JOIN account a ON a.id = g.account_id WHERE g.removed_at IS NULL ORDER BY g.created_at, g.id';

export function mapGoals(rows: readonly (readonly unknown[])[]): GoalRow[] {
  return rows.map((r) => {
    const target = Number(r[2]);
    const setAside = Number(r[9]);
    const moved = Number(r[10]);
    const contributed = setAside + moved;
    return {
      id: String(r[0]),
      name: String(r[1]),
      targetMinor: target,
      dueDate: r[3] === null ? null : String(r[3]),
      icon: String(r[4]),
      color: String(r[5]),
      accountId: r[6] === null ? null : String(r[6]),
      accountName: r[7] === null ? null : String(r[7]),
      state: String(r[8]) as GoalState,
      setAsideMinor: setAside,
      movedMinor: moved,
      contributedMinor: contributed,
      remainingMinor: Math.max(0, target - contributed),
      funded: contributed >= target,
    };
  });
}

export async function loadGoals(q: Querier): Promise<GoalRow[]> {
  return mapGoals(await q.query(GOALS_SQL));
}

/**
 * The planning query `setAsideTotal()`: money set aside minus taken back across active and paused goals only. A completed or
 * archived goal stops holding its set-aside money (it counts as free to use again) and holds it once more when restored.
 */
export async function setAsideTotal(q: Querier): Promise<number> {
  const r = (
    await q.query(
      "SELECT COALESCE(SUM(CASE WHEN x.kind = 'set_aside' THEN x.amount_minor WHEN x.kind = 'taken_back' THEN -x.amount_minor ELSE 0 END), 0) FROM goal_allocation x JOIN goal g ON g.id = x.goal_id WHERE g.removed_at IS NULL AND g.state IN ('active', 'paused')",
    )
  )[0];
  return Number(r?.[0] ?? 0);
}

export interface GoalDetail {
  readonly goal: GoalRow;
  /** Newest first. */
  readonly allocations: readonly GoalAllocationRow[];
}

/** One goal with every contribution it ever had: `Set aside` and `Moved to savings` entries, kept whatever the goal's state. */
export async function loadGoalDetail(q: Querier, id: string): Promise<GoalDetail | 'missing'> {
  const goal = (await loadGoals(q)).find((g) => g.id === id);
  if (!goal) return 'missing';
  const rows = await q.query('SELECT id, kind, amount_minor, transaction_id, local_date, created_at FROM goal_allocation WHERE goal_id = ? ORDER BY created_at DESC, id DESC', [id]);
  return {
    goal,
    allocations: rows.map((r) => ({ id: String(r[0]), kind: String(r[1]) as AllocationKind, amountMinor: Number(r[2]), transactionId: r[3] === null ? null : String(r[3]), localDate: String(r[4]), createdAt: Number(r[5]) })),
  };
}

// ---- Commands --------------------------------------------------------------------------------------------------------

export interface SaveGoalInput {
  /** Present when editing. */
  readonly id?: string;
  readonly name: string;
  readonly targetMinor: number;
  /** `YYYY-MM` the goal is by, or null/absent for no date. */
  readonly dueMonth?: string | null;
  readonly icon: string;
  readonly color: string;
  readonly accountId?: string | null;
}

export type SaveGoalError = 'NAME_REQUIRED' | 'AMOUNT_REQUIRED' | 'DATE_PAST' | 'DATE_INVALID' | 'COLOR_INVALID' | 'ICON_REQUIRED' | 'ACCOUNT_NOT_FOUND' | 'GOAL_NOT_FOUND' | 'NO_PROFILE';

export const GOAL_NAME_MAX = 40;

async function today(q: Querier, nowMs: number): Promise<string | null> {
  const p = await readPaydayRule(q);
  if (!p) return null;
  const t = toLocalDate(nowMs, p.timezoneId);
  return t.ok ? t.value : null;
}

/** A goal as it was, for Undo of an edit. */
export interface GoalSnapshot {
  readonly name: string;
  readonly targetMinor: number;
  readonly dueDate: string | null;
  readonly icon: string;
  readonly color: string;
  readonly accountId: string | null;
}

/** Adds a goal or edits one. A date in a past month is refused; an empty name or amount is refused; nothing else changes. */
export const SaveGoal: UseCase<SaveGoalInput, { goalId: string; created: boolean }, SaveGoalError> = {
  name: 'SaveGoal',
  async execute(ctx, input) {
    const name = input.name.trim();
    if (name === '') return err('NAME_REQUIRED');
    if (!Number.isSafeInteger(input.targetMinor) || input.targetMinor <= 0) return err('AMOUNT_REQUIRED');
    if (!(CATEGORY_COLOURS as readonly string[]).includes(input.color)) return err('COLOR_INVALID');
    if (input.icon.trim() === '') return err('ICON_REQUIRED');
    const t = await today(ctx, ctx.nowMs());
    if (t === null) return err('NO_PROFILE');
    let dueDate: string | null = null;
    if (input.dueMonth) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.dueMonth)) return err('DATE_INVALID');
      // Editing a goal whose month has gone by keeps that month: only a newly chosen past month is refused.
      const was = input.id !== undefined ? (await ctx.query('SELECT due_date FROM goal WHERE id = ? AND removed_at IS NULL', [input.id]))[0] : undefined;
      const unchanged = was !== undefined && was[0] !== null && String(was[0]).slice(0, 7) === input.dueMonth;
      if (input.dueMonth < t.slice(0, 7) && !unchanged) return err('DATE_PAST');
      dueDate = `${input.dueMonth}-01`;
    }
    const accountId = input.accountId ?? null;
    if (accountId !== null && (await ctx.query('SELECT 1 FROM account WHERE id = ?', [accountId])).length === 0) return err('ACCOUNT_NOT_FOUND');
    const now = ctx.nowMs();
    if (input.id !== undefined) {
      const found = (await ctx.query('SELECT 1 FROM goal WHERE id = ? AND removed_at IS NULL', [input.id]))[0];
      if (!found) return err('GOAL_NOT_FOUND');
      await ctx.execute('UPDATE goal SET name = ?, target_minor = ?, due_date = ?, icon = ?, color = ?, account_id = ?, updated_at = ? WHERE id = ?', [name, input.targetMinor, dueDate, input.icon, input.color, accountId, now, input.id]);
      ctx.touch('goal', input.id, { edited: true, label: name });
      ctx.emit('GoalsChanged', { goalIds: [input.id] });
      return ok({ goalId: input.id, created: false });
    }
    const id = ctx.newId();
    await ctx.execute('INSERT INTO goal (id, name, target_minor, due_date, icon, color, account_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, name, input.targetMinor, dueDate, input.icon, input.color, accountId, 'active', now, now]);
    ctx.touch('goal', id, { added: true, label: name });
    ctx.emit('GoalsChanged', { goalIds: [id] });
    return ok({ goalId: id, created: true });
  },
};

/** Undo of adding a goal: it leaves the lists (kept for audit). A goal with contributions is archived instead, so none is lost. */
export const UndoAddGoal: UseCase<{ goalId: string }, void, 'GOAL_NOT_FOUND'> = {
  name: 'UndoAddGoal',
  async execute(ctx, input) {
    const found = (await ctx.query('SELECT name FROM goal WHERE id = ? AND removed_at IS NULL', [input.goalId]))[0];
    if (!found) return err('GOAL_NOT_FOUND');
    const has = (await ctx.query('SELECT 1 FROM goal_allocation WHERE goal_id = ? LIMIT 1', [input.goalId])).length > 0;
    if (has) await ctx.execute("UPDATE goal SET state = 'archived', updated_at = ? WHERE id = ?", [ctx.nowMs(), input.goalId]);
    else await ctx.execute('UPDATE goal SET removed_at = ?, updated_at = ? WHERE id = ?', [ctx.nowMs(), ctx.nowMs(), input.goalId]);
    ctx.touch('goal', input.goalId, { undone: true, label: String(found[0]) });
    ctx.emit('GoalsChanged', { goalIds: [input.goalId] });
    return ok(undefined);
  },
};

async function readGoal(ctx: WriterContext, id: string): Promise<GoalRow | null> {
  return (await loadGoals(ctx)).find((g) => g.id === id) ?? null;
}

/** `only ₹5,000 is set aside`: the code carries the amount so the message can say it. */
export type TakeBackError = 'GOAL_NOT_FOUND' | 'AMOUNT_REQUIRED' | 'NOT_ACTIVE' | `EXCEEDS_SET_ASIDE:${number}`;
export const parseExceedsSetAside = (code: string): number | null => {
  const m = /^EXCEEDS_SET_ASIDE:(\d+)$/.exec(code);
  return m ? Number(m[1]) : null;
};

async function addAllocation(ctx: WriterContext, goalId: string, kind: AllocationKind, amountMinor: number, transactionId: string | null = null): Promise<string> {
  const t = (await today(ctx, ctx.nowMs())) ?? '1970-01-01';
  const id = ctx.newId();
  await ctx.execute('INSERT INTO goal_allocation (id, goal_id, kind, amount_minor, transaction_id, local_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, goalId, kind, amountMinor, transactionId, t, ctx.nowMs()]);
  return id;
}

/**
 * Sets money aside for a goal. Nothing moves: the money stays in its account and only stops counting as free to use. A
 * balance, `In accounts`, spending, the Savings bar and Left in budget are unchanged.
 */
export const SetAsideForGoal: UseCase<{ goalId: string; amountMinor: number }, { allocationId: string }, 'GOAL_NOT_FOUND' | 'AMOUNT_REQUIRED' | 'NOT_ACTIVE'> = {
  name: 'SetAsideForGoal',
  async execute(ctx, input) {
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) return err('AMOUNT_REQUIRED');
    const g = await readGoal(ctx, input.goalId);
    if (!g) return err('GOAL_NOT_FOUND');
    if (g.state !== 'active') return err('NOT_ACTIVE');
    const allocationId = await addAllocation(ctx, g.id, 'set_aside', input.amountMinor);
    ctx.touch('goal_allocation', allocationId, { setAside: true, label: g.name });
    ctx.emit('GoalsChanged', { goalIds: [g.id] });
    return ok({ allocationId });
  },
};

/** Takes money back from what was set aside; more than is set aside is refused. */
export const TakeBackFromGoal: UseCase<{ goalId: string; amountMinor: number }, { allocationId: string }, TakeBackError> = {
  name: 'TakeBackFromGoal',
  async execute(ctx, input) {
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) return err('AMOUNT_REQUIRED');
    const g = await readGoal(ctx, input.goalId);
    if (!g) return err('GOAL_NOT_FOUND');
    if (g.state !== 'active' && g.state !== 'paused') return err('NOT_ACTIVE');
    if (input.amountMinor > g.setAsideMinor) return err(`EXCEEDS_SET_ASIDE:${Math.max(0, g.setAsideMinor)}`);
    const allocationId = await addAllocation(ctx, g.id, 'taken_back', input.amountMinor);
    ctx.touch('goal_allocation', allocationId, { takenBack: true, label: g.name });
    ctx.emit('GoalsChanged', { goalIds: [g.id] });
    return ok({ allocationId });
  },
};

/** Undo of a set aside or a take back: that one allocation is removed. A move into savings is undone through its entry instead. */
export const UndoGoalAllocation: UseCase<{ allocationId: string }, void, 'ALLOCATION_NOT_FOUND' | 'NOT_UNDOABLE'> = {
  name: 'UndoGoalAllocation',
  async execute(ctx, input) {
    const r = (await ctx.query('SELECT goal_id, kind FROM goal_allocation WHERE id = ?', [input.allocationId]))[0];
    if (!r) return err('ALLOCATION_NOT_FOUND');
    if (String(r[1]) === 'moved') return err('NOT_UNDOABLE');
    await ctx.execute('DELETE FROM goal_allocation WHERE id = ?', [input.allocationId]);
    ctx.touch('goal_allocation', input.allocationId, { undone: true });
    ctx.emit('GoalsChanged', { goalIds: [String(r[0])] });
    return ok(undefined);
  },
};

const ALLOWED: Readonly<Record<GoalState, readonly GoalState[]>> = {
  active: ['paused', 'completed', 'archived'],
  paused: ['active', 'completed', 'archived'],
  completed: ['active', 'archived'],
  archived: ['active'],
};

/**
 * Pause, resume, complete, archive or restore a goal. Every allocation is kept and visible; a paused goal still holds its
 * set-aside money, a completed or archived one stops holding it, and restoring holds it again.
 */
export const ChangeGoalState: UseCase<{ goalId: string; to: GoalState }, { from: GoalState }, 'GOAL_NOT_FOUND' | 'NOT_ALLOWED'> = {
  name: 'ChangeGoalState',
  async execute(ctx, input) {
    const g = await readGoal(ctx, input.goalId);
    if (!g) return err('GOAL_NOT_FOUND');
    if (!ALLOWED[g.state].includes(input.to)) return err('NOT_ALLOWED');
    await ctx.execute('UPDATE goal SET state = ?, updated_at = ? WHERE id = ?', [input.to, ctx.nowMs(), g.id]);
    ctx.touch('goal', g.id, { state: input.to, from: g.state, label: g.name });
    ctx.emit('GoalsChanged', { goalIds: [g.id] });
    return ok({ from: g.state });
  },
};
