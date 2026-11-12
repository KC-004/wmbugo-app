import type { PaydayRule, PaydayRuleBase, PaydayTransition } from './payday';

/** An inclusive range of local dates (YYYY-MM-DD) in the profile timezone. */
export interface Period {
  readonly start: string;
  readonly end: string;
  readonly kind: 'calendar_month' | 'pay_cycle' | 'week' | 'custom';
  /** A pay cycle cut short by a payday change (Story 4.8): its budgets are pro-rated and it reads `Shortened cycle`. */
  readonly shortened?: boolean;
  /** For a shortened cycle: the length of the normal cycle it is cut from (the pro-rating base). */
  readonly normalDays?: number;
}

interface Ymd {
  readonly y: number;
  readonly m: number; // 1-12
  readonly d: number;
}

function parse(date: string): Ymd {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return { y, m, d };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const fmt = ({ y, m, d }: Ymd) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const weekday = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sunday

function shiftMonth(y: number, m: number, by: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + by;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/** The payday of a month: day N falls on the last day of shorter months; last working day is Mon to Fri. */
export function paydayInMonth(y: number, m: number, rule: Exclude<PaydayRule, { kind: 'none' }>): string {
  const last = daysIn(y, m);
  let d: number;
  switch (rule.kind) {
    case 'first':
      d = 1;
      break;
    case 'last_day':
      d = last;
      break;
    case 'last_working_day': {
      d = last;
      while (weekday(y, m, d) === 0 || weekday(y, m, d) === 6) d--;
      break;
    }
    case 'day':
      d = Math.min(rule.day, last);
      break;
  }
  return fmt({ y, m, d });
}

/** The day before a local date. */
export function previousDay(date: string): string {
  const { y, m, d } = parse(date);
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return fmt({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
}

/**
 * The period a local date belongs to. Not salaried: the calendar month. Otherwise the pay cycle: from the
 * latest payday on or before the date up to the day before the next one. Every date is in exactly one period.
 */
function basePeriodFor(localDate: string, rule: PaydayRuleBase): Period {
  const { y, m } = parse(localDate);
  if (rule.kind === 'none') {
    return { start: fmt({ y, m, d: 1 }), end: fmt({ y, m, d: daysIn(y, m) }), kind: 'calendar_month' };
  }
  const paydays = [-1, 0, 1].map((by) => {
    const s = shiftMonth(y, m, by);
    return paydayInMonth(s.y, s.m, rule);
  });
  // Dates compare correctly as strings (fixed width).
  let startIdx = 0;
  for (let i = 0; i < paydays.length; i++) if (paydays[i]! <= localDate) startIdx = i;
  const next = paydays[startIdx + 1] ?? (() => {
    const s = shiftMonth(y, m, 2);
    return paydayInMonth(s.y, s.m, rule);
  })();
  return { start: paydays[startIdx]!, end: previousDay(next), kind: 'pay_cycle' };
}

/**
 * The period a local date belongs to, following any payday changes (Story 4.8). Dates before a change use the rule that
 * was in force, the shortened cycle is one period, and later dates use the new rule, so every date is in exactly one
 * period and past periods never move.
 */
export function periodFor(localDate: string, rule: PaydayRule): Period {
  const ts = rule.transitions;
  const last = ts?.[ts.length - 1];
  if (!ts || !last) return basePeriodFor(localDate, rule);
  if (localDate >= last.start && localDate <= last.end) return { start: last.start, end: last.end, kind: 'pay_cycle', shortened: true, normalDays: last.normalDays };
  if (localDate > last.end) return basePeriodFor(localDate, rule);
  return periodFor(localDate, { ...last.previous, transitions: ts.slice(0, -1) });
}

/** The first payday on or after a date. */
export function nextPaydayOnOrAfter(date: string, rule: Exclude<PaydayRuleBase, { kind: 'none' }>): string {
  const { y, m } = parse(date);
  for (let by = 0; by < 3; by++) {
    const s = shiftMonth(y, m, by);
    const p = paydayInMonth(s.y, s.m, rule);
    if (p >= date) return p;
  }
  const s = shiftMonth(y, m, 3);
  return paydayInMonth(s.y, s.m, rule);
}

export interface PaydayChangePlan {
  readonly transition: PaydayTransition;
  /** The last day of the cycle that ends because of the change (`Your current cycle will end on 24 Nov`). */
  readonly cycleEnd: string;
  /** The shortened cycle, or null when the change falls exactly on a cycle boundary. */
  readonly shortened: { readonly start: string; readonly end: string } | null;
}

const withoutTransitions = (r: PaydayRule): PaydayRuleBase => (r.kind === 'day' ? { kind: 'day', day: r.day } : { kind: r.kind });

/**
 * What changing payday to `next` does today. The current cycle ends the day before the new payday falls, or, when that is
 * after its normal end, at its normal end and the days up to the new payday are one shortened cycle. No cycle is ever
 * longer than a normal one, and the past stays as it was.
 */
export function planPaydayChange(today: string, current: PaydayRule, next: Exclude<PaydayRuleBase, { kind: 'none' }>): PaydayChangePlan {
  const cur = periodFor(today, current);
  const newPayday = nextPaydayOnOrAfter(today, next);
  const previous = withoutTransitions(current);
  const normalDaysAt = (date: string) => periodDays(basePeriodFor(date, previous));
  if (newPayday <= cur.end) {
    const end = previousDay(newPayday);
    if (end < cur.start) return { transition: { start: newPayday, end, previous, normalDays: normalDaysAt(cur.start) }, cycleEnd: cur.end, shortened: null };
    return { transition: { start: cur.start, end, previous, normalDays: normalDaysAt(cur.start) }, cycleEnd: end, shortened: { start: cur.start, end } };
  }
  const start = addDays(cur.end, 1);
  const end = previousDay(newPayday);
  if (end < start) return { transition: { start: newPayday, end, previous, normalDays: normalDaysAt(start) }, cycleEnd: cur.end, shortened: null };
  return { transition: { start, end, previous, normalDays: normalDaysAt(start) }, cycleEnd: cur.end, shortened: { start, end } };
}

/** A target pro-rated to a shortened cycle: target × days ÷ normal days, rounded half up to the minor unit. */
export function prorateTarget(targetMinor: number, days: number, normalDays: number): number {
  if (normalDays <= 0) return targetMinor;
  return Math.floor((targetMinor * days * 2 + normalDays) / (2 * normalDays));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Sat 7 Nov". */
export function shortDate(date: string): string {
  const { y, m, d } = parse(date);
  return `${WEEKDAYS[weekday(y, m, d)]} ${d} ${MONTHS[m - 1]}`;
}

/** "Saturday 7 November" (spoken). */
export function longDate(date: string): string {
  const { y, m, d } = parse(date);
  return `${WEEKDAYS_LONG[weekday(y, m, d)]} ${d} ${MONTHS_LONG[m - 1]}`;
}

/** "Today · Sat 7 Nov", "Yesterday · Fri 6 Nov", "Thu 5 Nov". */
export function dayHeading(date: string, today: string): string {
  if (date === today) return `Today · ${shortDate(date)}`;
  if (date === previousDay(today)) return `Yesterday · ${shortDate(date)}`;
  return shortDate(date);
}

/** The scope label under "Spent this period": "This month" or "1 Nov to 30 Nov". */
export function periodLabel(period: Period, today: string): string {
  if (period.shortened) return periodTitle(period);
  const { y: ty, m: tm } = parse(today);
  const s = parse(period.start);
  const e = parse(period.end);
  if (period.kind === 'calendar_month' || (s.d === 1 && s.y === ty && s.m === tm && e.m === tm)) return 'This month';
  return `${s.d} ${MONTHS[s.m - 1]} to ${e.d} ${MONTHS[e.m - 1]}`;
}

/** Greeting by local hour (0-23). */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Payday rule stored on the profile row. */
export function paydayRuleFromRow(rule: string | null, day: number | null): PaydayRule {
  switch (rule) {
    case 'first':
    case 'last_day':
    case 'last_working_day':
      return { kind: rule };
    case 'day':
      return day !== null && day >= 1 && day <= 31 ? { kind: 'day', day } : { kind: 'none' };
    default:
      return { kind: 'none' };
  }
}

// ---- Budget periods (Story 4.5, AD-7) -------------------------------------------------------------------------------
// This file is the only place that turns a date into a period. Planning code asks for periods here and never computes a
// boundary itself (architecture test).

/** First day of the week, as the setting stores it. */
export type WeekStart = 'mon' | 'sun' | 'sat';

const WEEK_START_DAY: Readonly<Record<WeekStart, number>> = { sun: 0, mon: 1, sat: 6 };

/** A local date `by` days after (or before, when negative) another. */
export function addDays(date: string, by: number): string {
  const { y, m, d } = parse(date);
  const t = new Date(Date.UTC(y, m - 1, d + by));
  return fmt({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = parse(from);
  const b = parse(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/** The inclusive number of days in a period. */
export const periodDays = (p: { readonly start: string; readonly end: string }): number => daysBetween(p.start, p.end) + 1;

/** `1 Dec`. */
export function dayMonthLabel(date: string): string {
  const { m, d } = parse(date);
  return `${d} ${MONTHS[m - 1]}`;
}

/** The label of a period: `1–24 Nov`, and `1–24 Nov · Shortened cycle` for a shortened pay cycle. */
export const periodTitle = (p: { readonly start: string; readonly end: string; readonly shortened?: boolean }): string => `${periodRangeLabel(p.start, p.end)}${p.shortened ? ' · Shortened cycle' : ''}`;

/** `1–30 Nov` for one month, `25 Oct–24 Nov` across two. */
export function periodRangeLabel(start: string, end: string): string {
  const s = parse(start);
  const e = parse(end);
  return s.m === e.m && s.y === e.y ? `${s.d}–${e.d} ${MONTHS[e.m - 1]}` : `${s.d} ${MONTHS[s.m - 1]}–${e.d} ${MONTHS[e.m - 1]}`;
}

/** A real calendar date written YYYY-MM-DD (not 2026-02-31). */
export function isLocalDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parse(s);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);
}

/** The calendar month a local date is in. */
export function calendarMonthFor(localDate: string): Period {
  const { y, m } = parse(localDate);
  return { start: fmt({ y, m, d: 1 }), end: fmt({ y, m, d: daysIn(y, m) }), kind: 'calendar_month' };
}

/** The seven-day week a local date is in, starting on the profile's first day of the week. */
export function weekFor(localDate: string, firstDay: WeekStart): Period {
  const { y, m, d } = parse(localDate);
  const back = (weekday(y, m, d) - WEEK_START_DAY[firstDay] + 7) % 7;
  const start = addDays(localDate, -back);
  return { start, end: addDays(start, 6), kind: 'week' };
}

/** A one-off range, inclusive on both ends. */
export const customPeriod = (start: string, end: string): Period => ({ start, end, kind: 'custom' });

/** What a budget's period rule needs from the profile. */
export interface PeriodProfile {
  /** The payday rule, already turned into the calendar month when the profile counts by month. */
  readonly rule: PaydayRule;
  readonly firstDay: WeekStart;
}

export interface BudgetPeriodRule {
  readonly rule: 'default' | 'monthly' | 'weekly' | 'custom';
  readonly customStart?: string | null;
  readonly customEnd?: string | null;
}

/**
 * The period of a budget that contains a local date. A custom range has no period outside its dates (null): the budget
 * is not running then. Every other rule covers every date.
 */
export function budgetPeriodFor(budget: BudgetPeriodRule, localDate: string, profile: PeriodProfile): Period | null {
  switch (budget.rule) {
    case 'monthly':
      return calendarMonthFor(localDate);
    case 'weekly':
      return weekFor(localDate, profile.firstDay);
    case 'custom': {
      if (!budget.customStart || !budget.customEnd) return null;
      return localDate >= budget.customStart && localDate <= budget.customEnd ? customPeriod(budget.customStart, budget.customEnd) : null;
    }
    default:
      return periodFor(localDate, profile.rule);
  }
}

/**
 * The period just before another, by the same rule. A one-off custom range has none (null). A pay cycle is the one that
 * contains the day before this one starts, so an unusual cycle (a changed payday) never skips or overlaps.
 */
export function previousPeriod(period: Period, profile: PeriodProfile): Period | null {
  const before = addDays(period.start, -1);
  switch (period.kind) {
    case 'custom':
      return null;
    case 'week':
      return weekFor(before, profile.firstDay);
    case 'calendar_month':
      return calendarMonthFor(before);
    default:
      return periodFor(before, profile.rule);
  }
}
