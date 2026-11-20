import type { Querier } from '../planning/budgets';
import { loadGoals, type GoalRow } from '../planning/goals';
import { loadPlanTimeline, type TimelineItem } from '../planning/planTimeline';

/**
 * The Home cards `Coming up` and `Savings goal` (Story 6.10, HOM-001/002, GOAL-003). Read-only, from the planning queries the
 * Plan hub uses, so Home and Plan can never disagree. Neither shows Free to use, and neither changes any figure.
 */

export interface ComingUp {
  readonly today: string;
  /** `Before payday` or `Before month-end`. */
  readonly payCycle: boolean;
  /** Up to three unpaid due dates in the period, soonest first. */
  readonly items: readonly TimelineItem[];
  /** How many more unpaid ones there are: `+2 more`. */
  readonly moreCount: number;
}

/** Null without an active bill: the card is not rendered. With bills but nothing due before the period ends, `items` is empty. */
export async function homeComingUp(q: Querier, nowMs: number): Promise<ComingUp | null> {
  const t = await loadPlanTimeline(q, nowMs);
  if (!t || t.activeBills === 0) return null;
  const unpaid = t.items.filter((i) => i.status !== 'paid');
  return { today: t.today, payCycle: t.period.payCycle, items: unpaid.slice(0, 3), moreCount: Math.max(0, unpaid.length - 3) };
}

export interface SavingsGoalCard {
  readonly goal: GoalRow;
  /** Other active goals: `+1 more goal`. */
  readonly moreCount: number;
}

/**
 * The active goal with the nearest `By` date, otherwise the one that was contributed to most recently. Null without an active
 * goal: the card is not rendered. A paused goal is not active.
 */
export async function homeSavingsGoal(q: Querier, nowMs: number): Promise<SavingsGoalCard | null> {
  const active = (await loadGoals(q, nowMs)).filter((g) => g.state === 'active');
  if (active.length === 0) return null;
  const dated = active.filter((g) => g.dueDate !== null).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0));
  let goal = dated[0];
  if (!goal) {
    const last = new Map((await q.query("SELECT x.goal_id, MAX(x.created_at) FROM goal_allocation x WHERE x.kind = 'set_aside' OR (x.kind = 'moved' AND EXISTS (SELECT 1 FROM \"transaction\" t WHERE t.id = x.transaction_id AND t.status = 'confirmed' AND t.removed_at IS NULL)) GROUP BY x.goal_id")).map((r) => [String(r[0]), Number(r[1])]));
    goal = [...active].sort((a, b) => (last.get(b.id) ?? 0) - (last.get(a.id) ?? 0))[0]!;
  }
  return { goal, moreCount: active.length - 1 };
}
