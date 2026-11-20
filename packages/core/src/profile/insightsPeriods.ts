import { addDays, addMonthsClamped, calendarMonthFor, daysBetween, isLocalDate, periodFor, periodTitle, previousPeriod, type Period, type PeriodProfile } from './period';

/**
 * The periods Insights offers and the like-for-like comparison window (Story 7.1, INS-004, INS-005, AD-7). Every period
 * boundary in Insights comes from here: the `insights` module does no date arithmetic of its own. Ranges are inclusive local
 * dates in the profile timezone.
 */

export type PeriodPreset = 'this_cycle' | 'last_cycle' | 'today' | 'yesterday' | 'seven_days' | 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'custom';

export interface InsightsPeriod {
  readonly preset: PeriodPreset;
  readonly start: string;
  /** Inclusive. */
  readonly end: string;
  readonly kind: Period['kind'];
  readonly shortened: boolean;
  /** `1–30 Nov`, or `1–24 Nov · Shortened cycle`. */
  readonly title: string;
}

export interface DateSpan {
  readonly start: string;
  readonly end: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = (d: string) => ({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)), d: Number(d.slice(8, 10)) });
const pad = (n: number) => String(n).padStart(2, '0');

/** `Oct 1–8`, or `Oct 25–Nov 1` across months, or `Dec 28–Jan 3` across years. */
export function windowLabel(start: string, end: string): string {
  const a = ymd(start);
  const b = ymd(end);
  if (start === end) return `${MONTHS[a.m - 1]} ${a.d}`;
  if (a.y === b.y && a.m === b.m) return `${MONTHS[a.m - 1]} ${a.d}–${b.d}`;
  return `${MONTHS[a.m - 1]} ${a.d}–${MONTHS[b.m - 1]} ${b.d}`;
}

/** The presets the Period sheet lists: the pay-cycle ones only when a payday is set. */
export function availablePresets(profile: PeriodProfile): PeriodPreset[] {
  const base: PeriodPreset[] = ['today', 'yesterday', 'seven_days', 'this_month', 'last_month', 'this_quarter', 'this_year', 'custom'];
  return profile.rule.kind === 'none' ? base : ['this_cycle', 'last_cycle', ...base];
}

/** What Insights opens on: the default period Plan and Home use (this pay cycle, or this month without a payday). */
export const defaultPreset = (profile: PeriodProfile): PeriodPreset => (profile.rule.kind === 'none' ? 'this_month' : 'this_cycle');

const quarterOf = (date: string): DateSpan => {
  const { y, m } = ymd(date);
  const q = Math.floor((m - 1) / 3);
  const start = `${y}-${pad(q * 3 + 1)}-01`;
  return { start, end: addDays(addMonthsClamped(start, 3), -1) };
};
const yearOf = (date: string): DateSpan => ({ start: `${date.slice(0, 4)}-01-01`, end: `${date.slice(0, 4)}-12-31` });

const make = (preset: PeriodPreset, span: DateSpan, kind: Period['kind'], shortened = false): InsightsPeriod => ({
  preset,
  start: span.start,
  end: span.end,
  kind,
  shortened,
  title: periodTitle({ start: span.start, end: span.end, shortened }),
});

const fromPeriod = (preset: PeriodPreset, p: Period): InsightsPeriod => make(preset, { start: p.start, end: p.end }, p.kind, p.shortened === true);

/** A custom range is valid when both ends are dates, the end is not before the start and not after today. */
export function validateCustomRange(start: string, end: string, today: string): 'ok' | 'END_BEFORE_START' | 'AFTER_TODAY' | 'INVALID' {
  if (!isLocalDate(start) || !isLocalDate(end)) return 'INVALID';
  if (end < start) return 'END_BEFORE_START';
  if (end > today) return 'AFTER_TODAY';
  return 'ok';
}

/** The period a preset names for today; null for a pay-cycle preset without a payday or an invalid custom range. */
export function resolveInsightsPeriod(preset: PeriodPreset, today: string, profile: PeriodProfile, custom?: DateSpan): InsightsPeriod | null {
  const noPayday = profile.rule.kind === 'none';
  switch (preset) {
    case 'this_cycle':
      return noPayday ? null : fromPeriod(preset, periodFor(today, profile.rule));
    case 'last_cycle': {
      if (noPayday) return null;
      const prev = previousPeriod(periodFor(today, profile.rule), profile);
      return prev ? fromPeriod(preset, prev) : null;
    }
    case 'today':
      return make(preset, { start: today, end: today }, 'custom');
    case 'yesterday': {
      const y = addDays(today, -1);
      return make(preset, { start: y, end: y }, 'custom');
    }
    case 'seven_days':
      return make(preset, { start: addDays(today, -6), end: today }, 'custom');
    case 'this_month':
      return fromPeriod(preset, calendarMonthFor(today));
    case 'last_month':
      return fromPeriod(preset, calendarMonthFor(addDays(calendarMonthFor(today).start, -1)));
    case 'this_quarter':
      return make(preset, quarterOf(today), 'custom');
    case 'this_year':
      return make(preset, yearOf(today), 'custom');
    case 'custom':
      return custom && validateCustomRange(custom.start, custom.end, today) === 'ok' ? make(preset, custom, 'custom') : null;
  }
}

/** The period just before a selected one: the same rule for cycles and months, the same quarter or year, else the same number of days. */
function previousOf(p: InsightsPeriod, profile: PeriodProfile): DateSpan {
  const length = daysBetween(p.start, p.end) + 1;
  switch (p.preset) {
    case 'this_cycle':
    case 'last_cycle':
    case 'this_month':
    case 'last_month': {
      const prev = previousPeriod({ start: p.start, end: p.end, kind: p.kind, ...(p.shortened ? { shortened: true } : {}) }, profile);
      if (prev) return { start: prev.start, end: prev.end };
      break;
    }
    case 'this_quarter':
      return quarterOf(addDays(p.start, -1));
    case 'this_year':
      return yearOf(addDays(p.start, -1));
    default:
      break;
  }
  return { start: addDays(p.start, -length), end: addDays(p.start, -1) };
}

export interface ComparableWindow {
  readonly current: DateSpan;
  readonly previous: DateSpan;
  /** `Oct 1–8`: the previous window, as the Spending change tile prints it. */
  readonly label: string;
}

/**
 * The two windows a comparison uses (INS-004). A period still running compares the days so far with the same number of days
 * from the start of the previous period (capped at its length); an ended period compares the whole of both.
 */
export function comparableWindow(period: InsightsPeriod, today: string, profile: PeriodProfile): ComparableWindow {
  const prev = previousOf(period, profile);
  const running = today >= period.start && today <= period.end;
  if (!running) return { current: { start: period.start, end: period.end }, previous: prev, label: windowLabel(prev.start, prev.end) };
  const n = daysBetween(period.start, today) + 1;
  const prevEnd = addDays(prev.start, n - 1);
  const previous = { start: prev.start, end: prevEnd < prev.end ? prevEnd : prev.end };
  return { current: { start: period.start, end: today }, previous, label: windowLabel(previous.start, previous.end) };
}

/** The `count` periods of the same kind before a selected one (newest first), for the in and out comparison. */
export function earlierPeriods(period: InsightsPeriod, profile: PeriodProfile, count: number): DateSpan[] {
  const out: DateSpan[] = [];
  let cur: InsightsPeriod = period;
  for (let i = 0; i < count; i++) {
    const prev = previousOf(cur, profile);
    out.push(prev);
    const kind: Period['kind'] = cur.kind === 'pay_cycle' || cur.kind === 'calendar_month' ? cur.kind : 'custom';
    cur = { ...cur, start: prev.start, end: prev.end, kind, shortened: false };
  }
  return out;
}

/** The day after an inclusive end: the exclusive end the scope echo carries. */
export const exclusiveEnd = (end: string): string => addDays(end, 1);
