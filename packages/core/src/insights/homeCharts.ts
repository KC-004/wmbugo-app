import { UNCATEGORISED_ID } from '../ledger/categories';
import { SPENT_EXPENSES_SQL, SPENT_REFUNDS_SQL, spentMinor } from '../ledger/readModels';
import type { Querier } from '../planning/budgets';
import { readPeriodProfile } from '../planning/budgetStore';
import { categoryIdsUnder, needsWantsSavings } from '../planning/needsWantsSavings';
import { addDays, daysBetween, periodFor, shortDate } from '../profile/period';
import { toLocalDate } from '../shared/clock';

/**
 * What the Home charts read (Story 5.5, HOM-001, HOM-002, HOM-005). Counted from the entries through the owners' queries, never
 * stored; no trend and no comparison. All money is integer minor units.
 */

export interface TopCategory {
  readonly categoryId: string;
  readonly name: string;
  readonly icon: string;
  readonly colorToken: string;
  /** Refund-net spending of the category over the period, floored at zero (so always more than zero here). */
  readonly amountMinor: number;
  /** Whole percent of the period's spending (every ranked category together). */
  readonly sharePercent: number;
  /** The category and its subcategories, for the Activity filter behind the bar. */
  readonly categoryIds: readonly string[];
}

export interface TopCategories {
  /** Up to five, the most spent first. A category whose refunds are more than its spending is not ranked among spending. */
  readonly rows: readonly TopCategory[];
  /** All ranked spending, including categories beyond the top five. */
  readonly totalMinor: number;
  readonly period: { readonly start: string; readonly end: string };
}

export const TOP_CATEGORY_LIMIT = 5;

export async function homeTopCategories(q: Querier, nowMs: number): Promise<TopCategories | null> {
  const read = await readPeriodProfile(q);
  if (!read) return null;
  const today = toLocalDate(nowMs, read.timezoneId);
  if (!today.ok) return null;
  const period = periodFor(today.value, read.profile.rule);
  const nw = await needsWantsSavings(q, period);
  const ranked = [...nw.needs, ...nw.wants, ...nw.notClassified].filter((r) => r.amountMinor > 0).sort((a, b) => b.amountMinor - a.amountMinor || a.name.localeCompare(b.name));
  const totalMinor = ranked.reduce((s, r) => s + r.amountMinor, 0);
  const top = ranked.slice(0, TOP_CATEGORY_LIMIT);
  const rows: TopCategory[] = [];
  for (const r of top) {
    const meta = (await q.query('SELECT icon, color_token FROM category WHERE id = ?', [r.categoryId]))[0];
    rows.push({
      categoryId: r.categoryId,
      name: r.categoryId === UNCATEGORISED_ID ? 'Not classified' : r.name,
      icon: String(meta?.[0] ?? 'Tag'),
      colorToken: String(meta?.[1] ?? 'cat-slate'),
      amountMinor: r.amountMinor,
      // A ranked category always has some share: never `0%`.
      sharePercent: totalMinor === 0 ? 0 : Math.max(1, Math.round((r.amountMinor * 100) / totalMinor)),
      categoryIds: await categoryIdsUnder(q, [r.categoryId]),
    });
  }
  return { rows, totalMinor, period: { start: period.start, end: period.end } };
}

export interface SpendDay {
  readonly date: string;
  /** `Sun` to `Sat`, or `Today`. */
  readonly label: string;
  /** Refund-net confirmed spending of the day, floored at zero (the Activity day header's `Spent`). */
  readonly spentMinor: number;
  readonly isToday: boolean;
}

export interface Spend7d {
  /** One per day, oldest first, ending today; fewer than seven for a profile younger than a week. */
  readonly days: readonly SpendDay[];
  /** The first day wmbugo knows about, when it is later than six days ago: the card says `Since Thu 5 Nov`. */
  readonly since: string | null;
}

export async function homeSpend7d(q: Querier, nowMs: number): Promise<Spend7d | null> {
  const read = await readPeriodProfile(q);
  if (!read) return null;
  const today = toLocalDate(nowMs, read.timezoneId);
  if (!today.ok) return null;
  const created = Number((await q.query('SELECT created_at FROM profile LIMIT 1'))[0]?.[0] ?? 0);
  const first = toLocalDate(created, read.timezoneId);
  const windowStart = addDays(today.value, -6);
  // A profile cannot be younger than today (a clock or time zone change could say so): the window is never empty.
  const firstDay = first.ok && first.value > windowStart ? (first.value <= today.value ? first.value : today.value) : windowStart;
  const count = daysBetween(firstDay, today.value) + 1;
  const days: SpendDay[] = [];
  for (let i = 0; i < count; i++) {
    const date = addDays(firstDay, i);
    const expenses = Number((await q.query(SPENT_EXPENSES_SQL, [date, date]))[0]![0]);
    const refunds = Number((await q.query(SPENT_REFUNDS_SQL, [date, date]))[0]![0]);
    const isToday = date === today.value;
    days.push({ date, label: isToday ? 'Today' : shortDate(date).slice(0, 3), spentMinor: spentMinor(expenses, refunds), isToday });
  }
  return { days, since: count < 7 ? firstDay : null };
}
