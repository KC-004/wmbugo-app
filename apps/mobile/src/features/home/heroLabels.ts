import { notSetNote, type CurrencyCode, type HomeSummary } from '@wmbugo/core';
import { spokenAmount, spokenNumber } from '../../shared/a11y/labels';
import { copy } from '../../shared/copy';
import type { HeroView } from './heroPresenter';

const HIDDEN = 'amount hidden';

/** `In accounts 52,300 rupees` / `In accounts not set`, each with its `+1 account not set` note. */
function accountsPhrase(summary: HomeSummary, currency: CurrencyCode, locale: string | undefined, hidden: boolean): string[] {
  const a = summary.accounts;
  // No account: the setup text sits outside the merged node with its own button, so it is not repeated here.
  if (!a.hasAccounts) return [];
  const money = (minor: number | null) => (minor === null ? 'not set' : hidden ? HIDDEN : spokenAmount(minor, currency, locale));
  const out: string[] = [];
  const noteA = notSetNote(a.notSetCount, 'account');
  out.push(`${copy.home.inAccounts} ${money(a.inAccountsMinor)}${noteA ? `, ${noteA}` : ''}`);
  const noteC = notSetNote(a.notSetCards, 'card');
  if (a.cardDuesMinor !== null || a.notSetCards > 0) out.push(`${copy.home.cardDues} ${money(a.cardDuesMinor)}${noteC ? `, ${noteC}` : ''}`);
  return out;
}

/**
 * The hero as one TalkBack node, built from the view model (never from the drawn bar): the label and amount, spent of budget,
 * the daily line, the accounts, and what a double tap does. Amounts read as `amount hidden` while masked.
 * `Left in budget, 11,860 rupees. Spent 8,140 of 20,000. About 988 rupees per day, 12 days to payday. In accounts 52,300
 * rupees. Card dues 4,100 rupees. Double-tap for budget details`.
 */
export function heroLabel(view: HeroView, summary: HomeSummary, currency: CurrencyCode, locale: string | undefined, hidden: boolean): string {
  const full = (minor: number) => (hidden ? HIDDEN : spokenAmount(minor, currency, locale));
  const num = (minor: number) => (hidden ? HIDDEN : spokenNumber(minor, currency, locale));
  const parts: string[] = [];
  if (view.state === 'over') parts.push(hidden ? `${view.label}, ${HIDDEN}` : `${view.label} by ${full(view.amountMinor ?? 0)}`);
  else parts.push(`${view.label}, ${full(view.amountMinor ?? 0)}`);
  if (view.usedMinor !== null && view.targetMinor !== null) parts.push(`Spent ${num(view.usedMinor)} of ${num(view.targetMinor)}`);
  const days = view.state === 'spent_only' ? '' : (view.daysText ?? '');
  if (view.perDayMinor !== null) parts.push(`About ${full(view.perDayMinor)} per day, ${days}`);
  else if (days) parts.push(days);
  parts.push(...accountsPhrase(summary, currency, locale, hidden));
  parts.push(copy.home.hero.detailsHint);
  return parts.join('. ');
}
