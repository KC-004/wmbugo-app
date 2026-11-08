import type { AccessibilityRole, AccessibilityState } from 'react-native';
import { getCurrency, type CurrencyCode } from '@wmbugo/core';
import { formatPlainNumber } from '../formatAmount';

/** Spoken currency units (plural). TalkBack reads "85,000 rupees", not "INR 85,000.00". */
const UNIT: Readonly<Record<CurrencyCode, string>> = {
  INR: 'rupees', USD: 'US dollars', CAD: 'Canadian dollars', GBP: 'pounds', EUR: 'euros', AED: 'dirhams',
  SAR: 'riyals', QAR: 'riyals', BHD: 'dinars', KWD: 'dinars', OMR: 'rials', SGD: 'Singapore dollars',
  MYR: 'ringgit', CHF: 'Swiss francs', SEK: 'kronor', NOK: 'kroner', DKK: 'kroner', PLN: 'zloty',
  CZK: 'koruna', HUF: 'forints', THB: 'baht', IDR: 'rupiah', PHP: 'pesos', VND: 'dong',
};

export type AmountKind = 'plain' | 'spent' | 'income' | 'refund' | 'transfer' | 'over-budget';

/** "85,000 rupees"; an all-zero fraction is not spoken ("85,000.00" becomes "85,000"). */
export function spokenAmount(amountMinor: number, currency: CurrencyCode, locale?: string): string {
  const n = formatPlainNumber(amountMinor, currency, locale);
  if (!n.ok) return '';
  // Drop only the currency's exact minor digits when they are all zero; grouping zeros (1,000) stay.
  const cur = getCurrency(currency);
  const digits = cur.ok ? cur.value.exponent : 0;
  const trimmed = digits > 0 ? n.value.replace(new RegExp(`[.,]0{${digits}}$`), '') : n.value;
  return `${trimmed} ${UNIT[currency]}`;
}

export interface AmountLabelInput {
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
  readonly kind?: AmountKind;
  readonly locale?: string;
  /** Hidden amounts read "Amount hidden"; direction words still read. */
  readonly hidden?: boolean;
  /** A rough figure ("about 988 rupees"). */
  readonly approximate?: boolean;
  /** Lower-case the first letter so the label can sit inside a longer row label. */
  readonly inline?: boolean;
}

const LEAD: Readonly<Record<AmountKind, string>> = {
  plain: '',
  spent: 'Spent ',
  income: 'Income, plus ',
  refund: 'Refund, plus ',
  transfer: 'Transfer ',
  'over-budget': 'Over budget, ',
};

/** Amounts read in full with direction: "Income, plus 85,000 rupees", "Spent 420 rupees", "Amount hidden". */
export function amountLabel(input: AmountLabelInput): string {
  const kind = input.kind ?? 'plain';
  const lead = LEAD[kind];
  let text: string;
  if (input.hidden) {
    const word = lead.replace(/, plus $| $|, $/, '');
    text = word === '' ? 'Amount hidden' : `${word}, amount hidden`;
  } else {
    const said = spokenAmount(input.amountMinor, input.currency, input.locale);
    text = `${lead}${input.approximate ? 'about ' : ''}${said}`;
  }
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return input.inline ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** `~` is a rough-guide mark: it is read "about". */
export function aboutText(text: string): string {
  return text.replace(/~\s*/g, 'about ');
}

export interface ControlA11y {
  readonly accessible: true;
  readonly accessibilityRole: AccessibilityRole;
  readonly accessibilityLabel: string;
  readonly accessibilityState: AccessibilityState;
  readonly accessibilityHint?: string;
}

/**
 * Props that make a control announce its name, role and state: TalkBack reads
 * "Food, button, selected" from these. A disabled control stays focusable and
 * says why through the hint.
 */
export function controlA11y(input: {
  label: string;
  role?: AccessibilityRole;
  selected?: boolean;
  checked?: boolean;
  disabled?: boolean;
  hint?: string;
}): ControlA11y {
  const state: AccessibilityState = {};
  if (input.selected !== undefined) state.selected = input.selected;
  if (input.checked !== undefined) state.checked = input.checked;
  if (input.disabled) state.disabled = true;
  return {
    accessible: true,
    accessibilityRole: input.role ?? 'button',
    accessibilityLabel: aboutText(input.label),
    accessibilityState: state,
    ...(input.hint ? { accessibilityHint: aboutText(input.hint) } : {}),
  };
}
