import type { PaydayRule } from './payday';

/** An inclusive range of local dates (YYYY-MM-DD) in the profile timezone. */
export interface Period {
  readonly start: string;
  readonly end: string;
  readonly kind: 'calendar_month' | 'pay_cycle';
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
export function periodFor(localDate: string, rule: PaydayRule): Period {
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
