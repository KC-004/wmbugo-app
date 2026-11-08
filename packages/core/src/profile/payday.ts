import { err, ok, type Result } from '../shared/result';

/** When the user is paid; it decides the default budgeting period (AD-7, owned by the profile module). */
export type PaydayRule =
  | { readonly kind: 'first' }
  | { readonly kind: 'last_day' }
  | { readonly kind: 'last_working_day' }
  | { readonly kind: 'day'; readonly day: number }
  | { readonly kind: 'none' };

export type PaydayChoice = 'first' | 'last_day' | 'last_working_day' | 'other' | 'none';

/** Builds a rule from the chip and (for Other) the day typed. A day outside 1-31 is PAYDAY_INVALID. */
export function paydayFromChoice(choice: PaydayChoice, day?: number): Result<PaydayRule, 'PAYDAY_INVALID'> {
  switch (choice) {
    case 'first':
    case 'last_day':
    case 'last_working_day':
    case 'none':
      return ok({ kind: choice });
    case 'other':
      return Number.isInteger(day) && (day as number) >= 1 && (day as number) <= 31 ? ok({ kind: 'day', day: day as number }) : err('PAYDAY_INVALID');
  }
}

export type PeriodMode = 'pay_cycle' | 'calendar_month';

/** Paid on a date: the pay cycle. Not salaried: the calendar month. */
export function periodModeFor(rule: PaydayRule): PeriodMode {
  return rule.kind === 'none' ? 'calendar_month' : 'pay_cycle';
}

/** True for a payday rule the app can store: a known kind, and for `day` an integer from 1 to 31. */
export function isValidPayday(rule: PaydayRule): boolean {
  switch (rule.kind) {
    case 'first':
    case 'last_day':
    case 'last_working_day':
    case 'none':
      return true;
    case 'day':
      return Number.isInteger(rule.day) && rule.day >= 1 && rule.day <= 31;
    default:
      return false;
  }
}
