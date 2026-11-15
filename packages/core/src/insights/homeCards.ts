import { INCOME_SQL, SPENT_EXPENSES_SQL, SPENT_REFUNDS_SQL, spentMinor } from '../ledger/readModels';
import { loadBudgetList, type BudgetList, type BudgetListRow } from '../planning/budgetList';
import type { Querier } from '../planning/budgets';
import { readPeriodProfile } from '../planning/budgetStore';
import { periodFor } from '../profile/period';
import { toLocalDate } from '../shared/clock';

/**
 * What the Home cards under the hero read (Story 5.4, HOM-001, HOM-002). Each is composed from the owners' queries only and
 * counted from the entries, never stored. All money is integer minor units.
 */

/** Money in and out of the profile's default period. Transfers and card payments are in neither. */
export interface IncomeExpense {
  /** Confirmed income. */
  readonly incomeMinor: number;
  /** Confirmed expenses minus refunds, never below zero (the same figure as `Spent this period`). */
  readonly spentMinor: number;
  /** `in`: income is more, `out`: spending is more, `even`: equal. `netMinor` is the size of the difference, never negative. */
  readonly net: { readonly kind: 'in' | 'out' | 'even'; readonly minor: number };
  readonly period: { readonly start: string; readonly end: string };
}

export async function homeIncomeExpense(q: Querier, nowMs: number): Promise<IncomeExpense | null> {
  const read = await readPeriodProfile(q);
  if (!read) return null;
  const today = toLocalDate(nowMs, read.timezoneId);
  if (!today.ok) return null;
  const period = periodFor(today.value, read.profile.rule);
  const income = Number((await q.query(INCOME_SQL, [period.start, period.end]))[0]![0]);
  const expenses = Number((await q.query(SPENT_EXPENSES_SQL, [period.start, period.end]))[0]![0]);
  const refunds = Number((await q.query(SPENT_REFUNDS_SQL, [period.start, period.end]))[0]![0]);
  const spent = spentMinor(expenses, refunds);
  const diff = income - spent;
  return {
    incomeMinor: income,
    spentMinor: spent,
    net: { kind: diff > 0 ? 'in' : diff < 0 ? 'out' : 'even', minor: Math.abs(diff) },
    period: { start: period.start, end: period.end },
  };
}

/** The category budgets and the 50/30/20 progress for the Home budget cards. */
export interface HomeBudgetCards {
  /** Category budgets only (never the overall budget, which lives in the hero), the highest percent used first. */
  readonly categoryBudgets: readonly BudgetListRow[];
  /** The 50/30/20 rows (Needs, Wants, Savings) and what is not classified; null without 50/30/20 targets. */
  readonly nws: { readonly rows: readonly BudgetListRow[]; readonly typeSummary: BudgetList['typeSummary'] } | null;
  /** The default period, so a row on its own period can say so. */
  readonly defaultPeriod: { readonly start: string; readonly end: string };
}

export async function homeBudgetCards(q: Querier, nowMs: number): Promise<HomeBudgetCards | null> {
  const read = await readPeriodProfile(q);
  if (!read) return null;
  const today = toLocalDate(nowMs, read.timezoneId);
  if (!today.ok) return null;
  const period = periodFor(today.value, read.profile.rule);
  const list = await loadBudgetList(q, nowMs);
  if (!list) return null;
  const categoryBudgets = list.rows
    .filter((r) => r.group === 'categories')
    .sort((a, b) => b.status.percentUsed - a.status.percentUsed || a.name.localeCompare(b.name));
  const nwsRows = list.rows.filter((r) => r.group === '50_30_20');
  return {
    categoryBudgets,
    nws: nwsRows.length > 0 ? { rows: nwsRows, typeSummary: list.typeSummary } : null,
    defaultPeriod: { start: period.start, end: period.end },
  };
}
