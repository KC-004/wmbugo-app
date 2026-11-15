import { addDays, addMonthsClamped, daysBetween, monthsBetween } from '../profile/period';

/**
 * Bill rules and their due dates (Story 6.1, REC-001/004/006). A bill is a plan: nothing here touches a balance, a
 * transaction or a budget. Every date is a profile-local `YYYY-MM-DD`; the day of the month of the anchor is kept, a month
 * too short for it falls on its last day, and no date is ever a fixed 28 to 31 day step. Due dates are derived from the
 * anchor, never counted up and stored.
 */

export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'custom';
export type CustomUnit = 'days' | 'weeks' | 'months';
export type BillKind = 'subscription' | 'rent' | 'emi' | 'utility' | 'other';

export const CADENCES: readonly Cadence[] = ['weekly', 'monthly', 'quarterly', 'annual', 'custom'];
export const CUSTOM_UNITS: readonly CustomUnit[] = ['days', 'weeks', 'months'];
export const BILL_KINDS: readonly BillKind[] = ['subscription', 'rent', 'emi', 'utility', 'other'];

/** What the due dates depend on. */
export interface Recurrence {
  readonly cadence: Cadence;
  readonly customEvery: number | null;
  readonly customUnit: CustomUnit | null;
  /** The first due date. */
  readonly anchorDate: string;
}

/** A bill rule as the planning module holds it. */
export interface BillRule extends Recurrence {
  readonly id: string;
  readonly title: string;
  readonly expectedAmountMinor: number;
  /** Opaque refs into the ledger module. */
  readonly accountId: string | null;
  readonly categoryId: string | null;
  readonly kind: BillKind;
  readonly paidTo: string | null;
  readonly endsOn: string | null;
  /** Set while the rule is paused. */
  readonly pausedAt: number | null;
  readonly pausedOn: string | null;
  readonly resumedOn: string | null;
  readonly endedAt: number | null;
  readonly endedOn: string | null;
  readonly removedAt: number | null;
}

interface Step {
  readonly unit: 'days' | 'months';
  readonly every: number;
}

/** Weekly is 7 days, monthly 1 month, quarterly 3, annual 12; custom is every N days, weeks (7N days) or months. Null when the rule is malformed. */
function stepOf(r: Recurrence): Step | null {
  switch (r.cadence) {
    case 'weekly':
      return { unit: 'days', every: 7 };
    case 'monthly':
      return { unit: 'months', every: 1 };
    case 'quarterly':
      return { unit: 'months', every: 3 };
    case 'annual':
      return { unit: 'months', every: 12 };
    case 'custom': {
      const n = r.customEvery;
      if (n === null || !Number.isInteger(n) || n < 1 || n > 99) return null;
      if (r.customUnit === 'days') return { unit: 'days', every: n };
      if (r.customUnit === 'weeks') return { unit: 'days', every: n * 7 };
      if (r.customUnit === 'months') return { unit: 'months', every: n };
      return null;
    }
  }
}

/** The k-th due date counting the anchor as 0. */
function occurrenceAt(r: Recurrence, step: Step, k: number): string {
  return step.unit === 'days' ? addDays(r.anchorDate, k * step.every) : addMonthsClamped(r.anchorDate, k * step.every);
}

/** A safe lower bound for the index of the first due date on or after `from`. */
function startIndex(r: Recurrence, step: Step, from: string): number {
  if (from <= r.anchorDate) return 0;
  const n = step.unit === 'days' ? daysBetween(r.anchorDate, from) : monthsBetween(r.anchorDate, from);
  return Math.max(0, Math.floor(n / step.every) - 1);
}

/**
 * Every due date of a rule from `fromDate` to `toDate`, both inclusive. A monthly rule anchored on 31 Jan 2027 gives 31 Jan,
 * 28 Feb, 31 Mar, 30 Apr, 31 May (29 Feb in a leap year). It ignores pauses and ends: see `ruleOccurrences`.
 */
export function occurrences(rule: Recurrence, fromDate: string, toDate: string): string[] {
  const step = stepOf(rule);
  if (!step || toDate < fromDate) return [];
  const out: string[] = [];
  for (let k = startIndex(rule, step, fromDate); k < 100_000; k++) {
    const d = occurrenceAt(rule, step, k);
    if (d > toDate) break;
    if (d >= fromDate) out.push(d);
  }
  return out;
}

/** The first due date on or after `date` (the anchor at the earliest); null for a malformed rule. */
export function firstOccurrenceOnOrAfter(rule: Recurrence, date: string): string | null {
  const step = stepOf(rule);
  if (!step) return null;
  for (let k = startIndex(rule, step, date); k < 100_000; k++) {
    const d = occurrenceAt(rule, step, k);
    if (d >= date) return d;
  }
  return null;
}

/** True when `date` is one of the rule's due dates. */
export const isOccurrence = (rule: Recurrence, date: string): boolean => firstOccurrenceOnOrAfter(rule, date) === date;

// ---- Pauses, ends and removal -----------------------------------------------------------------------------------------

/** The last day a rule can fall due: the earlier of `ends_on` and the day it was ended; null when it never ends. */
export function lastDueDate(rule: Pick<BillRule, 'endsOn' | 'endedOn'>): string | null {
  const ends = [rule.endsOn, rule.endedOn].filter((x): x is string => x !== null);
  return ends.length === 0 ? null : ends.reduce((m, x) => (x < m ? x : m));
}

/**
 * True for a due date lost to a pause: from the day the rule was paused until the day it resumed (still paused, it never
 * resumes). Missed dates while paused are never created, so they never become `not_seen_yet`.
 */
function inPauseGap(rule: Pick<BillRule, 'pausedOn' | 'resumedOn' | 'pausedAt'>, date: string): boolean {
  if (rule.pausedOn === null || date < rule.pausedOn) return false;
  if (rule.pausedAt !== null) return true;
  return rule.resumedOn !== null && date < rule.resumedOn;
}

/** The due dates a rule really has in a range: not removed, nothing after its end, nothing lost to a pause. */
export function ruleOccurrences(rule: BillRule, fromDate: string, toDate: string): string[] {
  if (rule.removedAt !== null) return [];
  const last = lastDueDate(rule);
  const to = last !== null && last < toDate ? last : toDate;
  return occurrences(rule, fromDate, to).filter((d) => !inPauseGap(rule, d));
}

// ---- Paid, due soon, not seen yet ------------------------------------------------------------------------------------

export interface BillPayment {
  readonly ruleId: string;
  readonly dueDate: string;
  readonly kind: 'linked' | 'marked';
  readonly transactionId: string | null;
  readonly recordedAt: number;
}

export type BillStatus = 'paid' | 'upcoming' | 'due_soon' | 'not_seen_yet' | 'not_marked_paid';

export interface BillOccurrence {
  readonly ruleId: string;
  readonly title: string;
  readonly kind: BillKind;
  readonly expectedAmountMinor: number;
  readonly accountId: string | null;
  readonly categoryId: string | null;
  readonly dueDate: string;
  readonly status: BillStatus;
  /** For `due_soon`: 0 (today) to 3. */
  readonly daysUntilDue?: number;
  readonly payment?: BillPayment;
}

/** Due today to 3 days ahead. */
export const DUE_SOON_DAYS = 3;

/**
 * Each active rule's due dates in a range with their status. Paused rules show nothing from the day they paused, ended
 * rules nothing after their end, removed rules nothing. Only the most recent unpaid date that has passed is `not_seen_yet`;
 * when the next due date passes, the older one stays in the rule's history as `not_marked_paid` and is never marked paid
 * automatically. Paid dates keep their place whatever happens to the rule later.
 */
export function billOccurrences(rules: readonly BillRule[], payments: readonly BillPayment[], fromDate: string, toDate: string, today: string): BillOccurrence[] {
  const paidBy = new Map(payments.map((p) => [`${p.ruleId}|${p.dueDate}`, p]));
  const out: BillOccurrence[] = [];
  for (const rule of rules) {
    if (rule.removedAt !== null) continue;
    const step = stepOf(rule);
    if (!step) continue;
    // The newest due date before today, found from a window wide enough to hold one step.
    const window = step.unit === 'days' ? step.every : step.every * 31;
    const back = addDays(today, -(window + 1));
    const lastPast = ruleOccurrences(rule, back > rule.anchorDate ? back : rule.anchorDate, addDays(today, -1)).at(-1) ?? null;
    for (const d of ruleOccurrences(rule, fromDate, toDate)) {
      const payment = paidBy.get(`${rule.id}|${d}`);
      let status: BillStatus;
      let daysUntilDue: number | undefined;
      if (payment) status = 'paid';
      else if (d < today) status = d === lastPast ? 'not_seen_yet' : 'not_marked_paid';
      else {
        const n = daysBetween(today, d);
        if (n <= DUE_SOON_DAYS) {
          status = 'due_soon';
          daysUntilDue = n;
        } else status = 'upcoming';
      }
      out.push({ ruleId: rule.id, title: rule.title, kind: rule.kind, expectedAmountMinor: rule.expectedAmountMinor, accountId: rule.accountId, categoryId: rule.categoryId, dueDate: d, status, ...(daysUntilDue !== undefined ? { daysUntilDue } : {}), ...(payment ? { payment } : {}) });
    }
  }
  return out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0));
}

/**
 * The next due date, derived and never stored: the first due date after the latest one that has a payment row, or the
 * first on or after today when there is none. Recording one payment therefore moves it by exactly one due date. Null for a
 * paused, ended or removed rule, or when the rule has no due date left.
 */
export function nextDue(rule: BillRule, payments: readonly BillPayment[], today: string): string | null {
  if (rule.removedAt !== null || rule.pausedAt !== null || rule.endedAt !== null) return null;
  const paid = payments.filter((p) => p.ruleId === rule.id).map((p) => p.dueDate);
  let from = paid.length > 0 ? addDays(paid.reduce((m, d) => (d > m ? d : m)), 1) : today;
  for (let guard = 0; guard < 1000; guard++) {
    const d = firstOccurrenceOnOrAfter(rule, from);
    if (d === null) return null;
    const last = lastDueDate(rule);
    if (last !== null && d > last) return null;
    if (!inPauseGap(rule, d)) return d;
    from = addDays(d, 1);
  }
  return null;
}

// ---- Monthly equivalent (Story 6.4, REC-008) -----------------------------------------------------------------------

/** An exact fraction of minor units: sums stay exact and are rounded once, at the end. */
export interface Fraction {
  readonly num: bigint;
  readonly den: bigint;
}

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
const frac = (num: bigint, den: bigint): Fraction => {
  const g = gcd(num < 0n ? -num : num, den) || 1n;
  return { num: num / g, den: den / g };
};

/**
 * What a bill costs per month, exactly: yearly divided by 12, weekly times 52 divided by 12, every 3 months divided by 3,
 * and for a custom cadence every N days times 365 divided by 12N, every N weeks times 52 divided by 12N, every N months
 * divided by N. A malformed custom rule counts as zero.
 */
export function monthlyEquivalent(rule: Pick<Recurrence, 'cadence' | 'customEvery' | 'customUnit'> & { readonly expectedAmountMinor: number }): Fraction {
  const a = BigInt(rule.expectedAmountMinor);
  switch (rule.cadence) {
    case 'weekly':
      return frac(a * 52n, 12n);
    case 'monthly':
      return frac(a, 1n);
    case 'quarterly':
      return frac(a, 3n);
    case 'annual':
      return frac(a, 12n);
    case 'custom': {
      const n = rule.customEvery;
      if (n === null || !Number.isInteger(n) || n < 1 || n > 99) return frac(0n, 1n);
      const k = BigInt(n);
      if (rule.customUnit === 'days') return frac(a * 365n, 12n * k);
      if (rule.customUnit === 'weeks') return frac(a * 52n, 12n * k);
      if (rule.customUnit === 'months') return frac(a, k);
      return frac(0n, 1n);
    }
  }
}

/** Half-up to a whole number of minor units. */
export const roundHalfUp = (f: Fraction): number => Number((2n * f.num + f.den) / (2n * f.den));

/** The sum of several fractions, exact. */
export function sumFractions(list: readonly Fraction[]): Fraction {
  return list.reduce((acc, f) => frac(acc.num * f.den + f.num * acc.den, acc.den * f.den), frac(0n, 1n));
}
