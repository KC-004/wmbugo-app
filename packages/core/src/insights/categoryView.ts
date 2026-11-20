import type { CategorySpend } from './spending';

/**
 * What the `Where did it go?` section draws (Story 7.4, INS-012): the ranked categories with their shares, the refund-surplus
 * ones listed apart as `₹X back`, and the donut's segments. A share is the category's display amount over the sum of every
 * display amount above zero, in whole percents that add up to exactly 100 (largest remainder), so the labels never disagree
 * with the ring. Nothing here carries a signed amount.
 */

export interface RankedCategory extends CategorySpend {
  /** Whole percent of the eligible total; the ranked shares add to 100. */
  readonly sharePercent: number;
}

export interface DonutSegment {
  readonly id: string;
  readonly name: string;
  readonly colorToken: string;
  readonly amountMinor: number;
  readonly sharePercent: number;
  /** For `Other`: the categories it holds, so the drill-down can list them. */
  readonly members?: readonly RankedCategory[];
}

export interface CategoryView {
  /** Highest first, display amount above zero. */
  readonly ranked: readonly RankedCategory[];
  /** Categories whose refunds are more than their spending: `Shopping · ₹7,000 back`, no share. */
  readonly surplus: readonly CategorySpend[];
  /** The sum of the ranked display amounts: what the shares are taken over. */
  readonly eligibleMinor: number;
  readonly donut: readonly DonutSegment[];
}

export const DONUT_NAMED_SEGMENTS = 6;
export const OTHER_SEGMENT_ID = '__other__';

/** Whole percents that add to 100: floor each, then give the leftovers to the largest remainders. */
export function sharesOf(amounts: readonly number[]): number[] {
  const total = amounts.reduce((s, a) => s + a, 0);
  if (total <= 0) return amounts.map(() => 0);
  const raw = amounts.map((a) => (a * 100) / total);
  const floors = raw.map((r) => Math.floor(r));
  let left = 100 - floors.reduce((s, f) => s + f, 0);
  const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    floors[o.i]! += 1;
    left -= 1;
  }
  return floors;
}

export function categoryView(rows: readonly CategorySpend[]): CategoryView {
  const spending = rows.filter((r) => r.displayMinor > 0);
  const surplus = rows.filter((r) => r.displayMinor === 0 && r.backMinor > 0);
  const shares = sharesOf(spending.map((r) => r.displayMinor));
  const ranked = spending.map<RankedCategory>((r, i) => ({ ...r, sharePercent: shares[i]! }));
  const eligibleMinor = ranked.reduce((s, r) => s + r.displayMinor, 0);

  const named = ranked.length > DONUT_NAMED_SEGMENTS ? ranked.slice(0, DONUT_NAMED_SEGMENTS) : ranked;
  const rest = ranked.slice(named.length);
  const donut: DonutSegment[] = named.map((r) => ({ id: r.categoryId, name: r.name, colorToken: r.colorToken, amountMinor: r.displayMinor, sharePercent: r.sharePercent }));
  if (rest.length > 0) donut.push({ id: OTHER_SEGMENT_ID, name: 'Other', colorToken: 'bg-muted', amountMinor: rest.reduce((s, r) => s + r.displayMinor, 0), sharePercent: rest.reduce((s, r) => s + r.sharePercent, 0), members: rest });
  return { ranked, surplus, eligibleMinor, donut };
}
