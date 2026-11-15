import { dayMonthLabel, type BillKind, type BillRowModel, type BillStatusLine, type Cadence, type CustomUnit } from '@wmbugo/core';
import { copy } from '../../shared/copy';

const b = copy.bills;

export const KIND_LABEL: Readonly<Record<BillKind, string>> = { subscription: b.kindSubscription, rent: b.kindRent, emi: b.kindEmi, utility: b.kindUtility, other: b.kindOther };

/** `Monthly`, `Every 3 months`, `Every 10 days`. */
export function cadenceText(r: { cadence: Cadence; customEvery: number | null; customUnit: CustomUnit | null }): string {
  switch (r.cadence) {
    case 'weekly':
      return b.cadenceWeekly;
    case 'monthly':
      return b.cadenceMonthly;
    case 'quarterly':
      return b.cadenceQuarterly;
    case 'annual':
      return b.cadenceYearly;
    case 'custom':
      return b.cadenceCustom.replace('{n}', String(r.customEvery ?? '')).replace('{unit}', (r.customUnit === 'weeks' ? b.weeks : r.customUnit === 'months' ? b.months : b.days).toLowerCase());
  }
}

export interface StatusText {
  readonly text: string;
  /** Due soon uses the warning styling (icon and text, never colour alone). */
  readonly tone: 'normal' | 'warning' | 'muted' | 'paid';
}

/** The one status line under a bill (UX-DR25 due soon, REC-004). No amount appears in it, so hiding amounts never touches it. */
export function statusText(s: BillStatusLine): StatusText {
  switch (s.kind) {
    case 'upcoming':
      return { text: s.date ? b.dueOn.replace('{date}', dayMonthLabel(s.date)) : '', tone: 'normal' };
    case 'due_soon': {
      const n = s.daysUntilDue ?? 0;
      return { text: n === 0 ? b.dueToday : n === 1 ? b.dueTomorrow : b.dueInDays.replace('{n}', String(n)), tone: 'warning' };
    }
    case 'paid':
      return { text: s.paidBy === 'marked' ? b.paidMarked : b.paidOn.replace('{date}', s.date ? dayMonthLabel(s.date) : ''), tone: 'paid' };
    case 'not_seen_yet':
      return { text: b.notSeen.replace('{date}', s.date ? dayMonthLabel(s.date) : ''), tone: 'muted' };
    case 'paused':
      return { text: b.paused, tone: 'muted' };
    case 'ended':
      return { text: b.ended, tone: 'muted' };
  }
}

/** `Monthly · HDFC · Rent`. */
export const captionText = (r: BillRowModel): string => [cadenceText(r), r.accountName, KIND_LABEL[r.kind]].filter(Boolean).join(' · ');
