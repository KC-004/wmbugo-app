import { merchantNets } from '../ledger/spendingQueries';
import type { Querier } from '../planning/budgets';
import { normalizeMerchant } from '../shared/merchant';
import { ledgerFilters, scopeEcho, type InsightsScope, type ScopeEcho } from './scope';

/**
 * Spending by merchant (Story 7.6, INS-014): the same refund-net rules as every other Insights figure, grouped by the normalized
 * merchant key (LRN-009), so `SWIGGY*BLR 8821` and `Swiggy` are one merchant. The grouping itself is done by SQLite over the
 * entries; only the few distinct spellings are folded here. A refund surplus is `backMinor`, never a negative.
 */

export interface MerchantSpend {
  /** The normalized key; empty for entries with no merchant. */
  readonly key: string;
  /** The name to show: the spelling that carries the most money, shortest on a tie. `No merchant` for the empty key. */
  readonly name: string;
  readonly displayMinor: number;
  readonly backMinor: number;
  readonly entries: number;
  readonly noMerchant: boolean;
}

export interface SpendingByMerchant {
  readonly scope: ScopeEcho;
  /** Ranked merchants with spending, highest first (all of them: the screen shows the top ten and offers the rest). */
  readonly ranked: readonly MerchantSpend[];
  /** The `No merchant` group when it has spending, shown after the ranked merchants. */
  readonly noMerchant: MerchantSpend | null;
  /** Merchants whose refunds are more than their spending: `Amazon · ₹2,000 back`. */
  readonly surplus: readonly MerchantSpend[];
}

export const NO_MERCHANT = 'No merchant';

export async function spendingByMerchant(q: Querier, scope: InsightsScope): Promise<SpendingByMerchant> {
  const rows = await merchantNets(q, { start: scope.period.start, end: scope.period.end }, await ledgerFilters(q, scope));
  interface Acc {
    net: number;
    entries: number;
    best: { name: string; weight: number };
  }
  const byKey = new Map<string, Acc>();
  for (const r of rows) {
    const key = r.description === null ? '' : normalizeMerchant(r.description);
    const acc = byKey.get(key) ?? { net: 0, entries: 0, best: { name: r.description ?? NO_MERCHANT, weight: -1 } };
    acc.net += r.netMinor;
    acc.entries += r.entries;
    const name = r.description ?? NO_MERCHANT;
    const weight = Math.abs(r.netMinor);
    if (weight > acc.best.weight || (weight === acc.best.weight && name.length < acc.best.name.length)) acc.best = { name, weight };
    byKey.set(key, acc);
  }
  const all = [...byKey.entries()]
    .filter(([, a]) => a.net !== 0)
    .map<MerchantSpend>(([key, a]) => ({ key, name: key === '' ? NO_MERCHANT : a.best.name, displayMinor: Math.max(0, a.net), backMinor: Math.max(0, -a.net), entries: a.entries, noMerchant: key === '' }));
  const byAmount = (a: MerchantSpend, b: MerchantSpend) => b.displayMinor - a.displayMinor || a.name.localeCompare(b.name);
  const ranked = all.filter((m) => !m.noMerchant && m.displayMinor > 0).sort(byAmount);
  const none = all.find((m) => m.noMerchant && m.displayMinor > 0) ?? null;
  const surplus = all.filter((m) => m.displayMinor === 0 && m.backMinor > 0).sort((a, b) => b.backMinor - a.backMinor || a.name.localeCompare(b.name));
  return { scope: scopeEcho(scope), ranked, noMerchant: none, surplus };
}
