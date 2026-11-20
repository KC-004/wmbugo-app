import { addDays, calendarMonthFor, daysBetween, periodTitle, weekFor, type PeriodProfile } from './period';
import { windowLabel, type DateSpan, type InsightsPeriod } from './insightsPeriods';

/**
 * The buckets of a drill-down chart and a trend (Story 7.3, 7.5): a day per bar up to 31 days, a week per bar up to 92 days, a
 * month per bar beyond. Every boundary comes from here, so `insights` does no date arithmetic of its own.
 */
export type Granularity = 'day' | 'week' | 'month';

export function granularityFor(span: DateSpan): Granularity {
  const n = daysBetween(span.start, span.end) + 1;
  return n <= 31 ? 'day' : n <= 92 ? 'week' : 'month';
}

/** The bucket a date falls in, clipped to the span (a week or month cut by the period reads as the part inside it). */
export function bucketOf(date: string, g: Granularity, span: DateSpan, firstDay: PeriodProfile['firstDay']): DateSpan {
  const whole: DateSpan = g === 'day' ? { start: date, end: date } : g === 'week' ? weekFor(date, firstDay) : calendarMonthFor(date);
  return { start: whole.start < span.start ? span.start : whole.start, end: whole.end > span.end ? span.end : whole.end };
}

/** `Nov 5`, `Nov 2–8`, or `Nov` for a month. */
export function bucketLabel(b: DateSpan, g: Granularity): string {
  return g === 'month' ? windowLabel(b.start, b.start).split(' ')[0]! : windowLabel(b.start, b.end);
}

/** Every bucket of a span in order, including those with nothing in them. */
export function bucketsOf(span: DateSpan, g: Granularity, firstDay: PeriodProfile['firstDay']): DateSpan[] {
  const out: DateSpan[] = [];
  let cur = span.start;
  while (cur <= span.end) {
    const b = bucketOf(cur, g, span, firstDay);
    out.push(b);
    cur = addDays(b.end, 1);
  }
  return out;
}

/** Narrows a period to part of itself (a day, a week) without checking it against today: the part is already inside it. */
export function narrowPeriod(period: InsightsPeriod, span: DateSpan): InsightsPeriod {
  return { ...period, preset: 'custom', start: span.start, end: span.end, kind: 'custom', shortened: false, title: periodTitle({ start: span.start, end: span.end }) };
}
