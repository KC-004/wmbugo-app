import { normalizeMerchant } from '../shared/merchant';
import { toLocalDate } from '../shared/clock';
import { merchantDescriptions, type LedgerEntryType, type LedgerFilters } from '../ledger/spendingQueries';
import type { Querier } from '../planning/budgets';
import { readPeriodProfile } from '../planning/budgetStore';
import { exclusiveEnd, type InsightsPeriod } from '../profile/insightsPeriods';
import type { PeriodProfile } from '../profile/period';

/**
 * The scope every Insights figure is counted for (Story 7.1): a period from the period service plus the filters the user
 * chose. Every result echoes its scope, so a screen prints the label without recomputing it.
 */

export interface InsightsFilters {
  readonly accountIds?: readonly string[];
  readonly categoryIds?: readonly string[];
  /** Normalized merchant keys (`swiggy`); the empty key is `No merchant`. */
  readonly merchantKeys?: readonly string[];
  readonly types?: readonly LedgerEntryType[];
  readonly tags?: readonly string[];
  readonly sources?: readonly string[];
}

export interface InsightsScope {
  readonly period: InsightsPeriod;
  readonly filters: InsightsFilters;
}

/** The scope a result carries back: inclusive start, exclusive end, the label and the active filters. */
export interface ScopeEcho {
  readonly start: string;
  /** The last day, inclusive (what a CSV header prints). */
  readonly end: string;
  readonly endExclusive: string;
  /** `1–30 Nov` or `1–24 Nov · Shortened cycle`. */
  readonly label: string;
  readonly filters: InsightsFilters;
}

export const scopeEcho = (scope: InsightsScope): ScopeEcho => ({ start: scope.period.start, end: scope.period.end, endExclusive: exclusiveEnd(scope.period.end), label: scope.period.title, filters: scope.filters });

/** What a query needs besides the scope: today and the period rules, read once. */
export interface InsightsContext {
  readonly today: string;
  readonly profile: PeriodProfile;
  readonly timezoneId: string;
  /** The first local day wmbugo has an entry for, or the day the profile was made when there is none. */
  readonly firstDay: string;
}

export async function loadInsightsContext(q: Querier, nowMs: number): Promise<InsightsContext | null> {
  const read = await readPeriodProfile(q);
  if (!read) return null;
  const today = toLocalDate(nowMs, read.timezoneId);
  if (!today.ok) return null;
  const created = Number((await q.query('SELECT created_at FROM profile LIMIT 1'))[0]?.[0] ?? 0);
  const made = toLocalDate(created, read.timezoneId);
  const firstEntry = (await q.query('SELECT MIN(local_date) FROM "transaction"'))[0]?.[0];
  const candidates = [made.ok ? made.value : null, firstEntry === null || firstEntry === undefined ? null : String(firstEntry)].filter((x): x is string => x !== null);
  const firstDay = candidates.length === 0 ? today.value : candidates.reduce((m, x) => (x < m ? x : m));
  return { today: today.value, profile: read.profile, timezoneId: read.timezoneId, firstDay: firstDay > today.value ? today.value : firstDay };
}

/** The ledger filters for a scope: merchant keys become the raw descriptions that normalize to them. */
export async function ledgerFilters(q: Querier, scope: InsightsScope): Promise<LedgerFilters> {
  const f = scope.filters;
  let descriptions: (string | null)[] | undefined;
  if (f.merchantKeys && f.merchantKeys.length > 0) {
    const wanted = new Set(f.merchantKeys);
    const all = await merchantDescriptions(q, { start: scope.period.start, end: scope.period.end });
    descriptions = all.filter((d) => wanted.has(normalizeMerchant(d)));
    if (wanted.has('')) descriptions.push(null);
    if (descriptions.length === 0) descriptions = ['__no_such_merchant__'];
  }
  return {
    ...(f.accountIds?.length ? { accountIds: f.accountIds } : {}),
    ...(f.categoryIds?.length ? { categoryIds: f.categoryIds } : {}),
    ...(descriptions ? { descriptions } : {}),
    ...(f.types?.length ? { types: f.types } : {}),
    ...(f.tags?.length ? { tags: f.tags } : {}),
    ...(f.sources?.length ? { sources: f.sources } : {}),
  };
}

/** How many filters are active (one per chosen value). */
export const activeInsightsFilters = (f: InsightsFilters): number => (f.accountIds?.length ?? 0) + (f.categoryIds?.length ?? 0) + (f.merchantKeys?.length ?? 0) + (f.types?.length ?? 0) + (f.tags?.length ?? 0) + (f.sources?.length ?? 0);
