import {
  ACCOUNT_LIST_SQL,
  availablePresets,
  categoryView,
  incomeVsExpense,
  onTrack,
  defaultPreset,
  entriesInScope,
  filterFacets,
  incomeTotal,
  kept,
  loadInsightsContext,
  mapAccountRows,
  merchantDescriptions,
  normalizeMerchant,
  resolveInsightsPeriod,
  spendingByCategory,
  spendingByMerchant,
  spendingChange,
  spendingTotal,
  spendingTrend,
  waitingInScope,
  type CategoryView,
  type Granularity,
  type IncomeVsExpense,
  type OnTrack,
  type CurrencyCode,
  type IncomeTotal,
  type InsightsFilters,
  type InsightsPeriod,
  type InsightsScope,
  type Kept,
  type PeriodPreset,
  type SpendingByCategory,
  type SpendingByMerchant,
  type SpendingChange,
  type SpendingTotal,
  type SpendingTrend,
} from '@wmbugo/core';
import { getServices, systemClock } from '../../adapters/startApp';
import { readProfile } from '../../adapters/readProfile';
import { copy } from '../../shared/copy';

/** What the user picked on Insights: a preset (or the default), a custom range, and the filters. Transient: gone after process death. */
export interface InsightsSelection {
  readonly preset: PeriodPreset | 'default';
  readonly custom?: { readonly start: string; readonly end: string };
  readonly filters: InsightsFilters;
}

export const DEFAULT_SELECTION: InsightsSelection = { preset: 'default', filters: {} };

/** The names behind the active filters, so a tile can say `HDFC only`. */
export interface FilterNames {
  readonly accounts: Readonly<Record<string, string>>;
  readonly categories: Readonly<Record<string, string>>;
  readonly merchants: Readonly<Record<string, string>>;
}

export interface InsightsOverview {
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly today: string;
  readonly firstDay: string;
  readonly period: InsightsPeriod;
  /** The preset the period resolved from (the default's own name when nothing was picked). */
  readonly preset: PeriodPreset;
  readonly presets: readonly PeriodPreset[];
  readonly scope: InsightsScope;
  /** `HDFC only · Food`: what the active filters say, for the tile labels. */
  readonly scopeParts: readonly string[];
  /** One removable chip per active filter value. */
  readonly filterChips: readonly FilterChip[];
  readonly spent: SpendingTotal;
  readonly income: IncomeTotal;
  readonly change: SpendingChange;
  readonly kept: Kept;
  readonly waiting: number;
  /** Confirmed entries in the period under no filters: zero shows the empty prompt. */
  readonly entries: number;
}

export interface FilterChip {
  readonly key: keyof InsightsFilters;
  readonly value: string;
  readonly label: string;
}

export interface CategoriesData {
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly byCategory: SpendingByCategory;
  readonly total: SpendingTotal;
  readonly view: CategoryView;
  readonly scopeParts: readonly string[];
}

export interface TrendData {
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly trend: SpendingTrend;
}

export interface InOutData {
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly inOut: IncomeVsExpense;
}

export interface MerchantsData {
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly merchants: SpendingByMerchant;
  readonly scopeParts: readonly string[];
}

export interface OnTrackData {
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly thisMonth: string;
  readonly track: OnTrack;
}

export const onTrackKey = (selection: InsightsSelection) => ['insights', 'ontrack', selection] as const;
export const merchantsKey = (selection: InsightsSelection) => ['insights', 'merchants', selection] as const;
export const trendKey = (selection: InsightsSelection, g: Granularity | undefined) => ['insights', 'trend', selection, g ?? null] as const;
export const inOutKey = (selection: InsightsSelection) => ['insights', 'inout', selection] as const;
export const categoriesKey = (selection: InsightsSelection) => ['insights', 'categories', selection] as const;

export interface InsightsFacets {
  readonly accounts: readonly { id: string; name: string }[];
  readonly categories: readonly { id: string; name: string }[];
  readonly merchants: readonly { key: string; name: string }[];
  readonly tags: readonly string[];
  readonly sources: readonly string[];
}

/** What Insights reads. The real one goes through core; tests pass a fake. */
export interface InsightsApi {
  loadOverview(selection: InsightsSelection): Promise<InsightsOverview | null>;
  loadFacets(selection: InsightsSelection): Promise<InsightsFacets | null>;
  /** Story 7.4: spending by category for the scope. */
  loadCategories(selection: InsightsSelection): Promise<CategoriesData | null>;
  /** Story 7.5: spending over time for the scope, and money in and out over recent periods. */
  loadTrend(selection: InsightsSelection, granularity?: Granularity): Promise<TrendData | null>;
  loadInOut(selection: InsightsSelection): Promise<InOutData | null>;
  /** Story 7.6: spending by merchant for the scope. */
  loadMerchants(selection: InsightsSelection): Promise<MerchantsData | null>;
  /** Story 7.7: budgets, Needs / Wants / Savings and goals. */
  loadOnTrack(selection: InsightsSelection): Promise<OnTrackData | null>;
}

/** The copy key of a preset: `this_cycle` reads as `thisCycle`. */
export const presetName = (p: PeriodPreset): string => i.presets[p.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase()) as keyof typeof i.presets];

export const insightsKey = (selection: InsightsSelection) => ['insights', 'overview', selection] as const;
export const facetsKey = (selection: InsightsSelection) => ['insights', 'facets', selection.preset, selection.custom ?? null] as const;

const i = copy.insights;

/** `HDFC only`, `2 accounts`, `Food`, `Swiggy only`: the scope words for the active filters, in a stable order. */
export function scopeParts(filters: InsightsFilters, names: FilterNames): string[] {
  const out: string[] = [];
  const a = filters.accountIds ?? [];
  if (a.length === 1) out.push(i.onlyAccount.replace('{name}', names.accounts[a[0]!] ?? ''));
  else if (a.length > 1) out.push(i.nAccounts.replace('{n}', String(a.length)));
  const c = filters.categoryIds ?? [];
  if (c.length === 1) out.push(names.categories[c[0]!] ?? '');
  else if (c.length > 1) out.push(i.nCategories.replace('{n}', String(c.length)));
  const m = filters.merchantKeys ?? [];
  if (m.length === 1) out.push(i.onlyAccount.replace('{name}', names.merchants[m[0]!] ?? m[0]!));
  else if (m.length > 1) out.push(i.nMerchants.replace('{n}', String(m.length)));
  const t = filters.types ?? [];
  if (t.length > 0) out.push(t.map((x) => (x === 'expense' ? i.typeExpense : x === 'income' ? i.typeIncome : i.typeRefund)).join(' · '));
  const tg = filters.tags ?? [];
  if (tg.length === 1) out.push(`#${tg[0]}`);
  else if (tg.length > 1) out.push(i.nTags.replace('{n}', String(tg.length)));
  const s = filters.sources ?? [];
  if (s.length === 1) out.push(i.sourceNames[s[0] as keyof typeof i.sourceNames] ?? s[0]!);
  else if (s.length > 1) out.push(i.nSources.replace('{n}', String(s.length)));
  return out;
}

/** One chip per active filter value, named. */
export function filterChips(filters: InsightsFilters, names: FilterNames): FilterChip[] {
  const out: FilterChip[] = [];
  for (const v of filters.accountIds ?? []) out.push({ key: 'accountIds', value: v, label: names.accounts[v] ?? v });
  for (const v of filters.categoryIds ?? []) out.push({ key: 'categoryIds', value: v, label: names.categories[v] ?? v });
  for (const v of filters.merchantKeys ?? []) out.push({ key: 'merchantKeys', value: v, label: names.merchants[v] ?? v });
  for (const v of filters.types ?? []) out.push({ key: 'types', value: v, label: v === 'expense' ? i.typeExpense : v === 'income' ? i.typeIncome : i.typeRefund });
  for (const v of filters.tags ?? []) out.push({ key: 'tags', value: v, label: `#${v}` });
  for (const v of filters.sources ?? []) out.push({ key: 'sources', value: v, label: i.sourceNames[v as keyof typeof i.sourceNames] ?? v });
  return out;
}

/** The merchants seen in a period, folded by their normalized key, with the commonest spelling as the display name. */
export async function merchantsSeen(from: string, to: string): Promise<{ key: string; name: string }[]> {
  const db = getServices().db;
  const seen = await merchantDescriptions(db, { start: from, end: to });
  const byKey = new Map<string, { name: string; n: number }>();
  for (const d of seen) {
    const key = normalizeMerchant(d);
    if (key === '') continue;
    const cur = byKey.get(key);
    byKey.set(key, cur ? { name: cur.name.length <= d.length ? cur.name : d, n: cur.n + 1 } : { name: d, n: 1 });
  }
  return [...byKey.entries()].map(([key, v]) => ({ key, name: v.name })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function resolveSelection(selection: InsightsSelection) {
  const db = getServices().db;
  const ctx = await loadInsightsContext(db, systemClock.nowMs());
  if (!ctx) return null;
  const wanted: PeriodPreset = selection.preset === 'default' ? defaultPreset(ctx.profile) : selection.preset;
  // A preset that needs a payday falls back to the default when the payday is gone; a bad custom range to this month.
  const period = resolveInsightsPeriod(wanted, ctx.today, ctx.profile, selection.custom) ?? resolveInsightsPeriod(defaultPreset(ctx.profile), ctx.today, ctx.profile)!;
  return { db, ctx, period };
}

export const realInsightsApi: InsightsApi = {
  async loadOverview(selection) {
    const r = await resolveSelection(selection);
    const profile = await readProfile(getServices().db);
    if (!r || !profile) return null;
    const { db, ctx, period } = r;
    const scope: InsightsScope = { period, filters: selection.filters };
    const names = await filterNames(selection.filters, period);
    const bare: InsightsScope = { period, filters: {} };
    const [spent, income, change, keptV, waiting, entries] = await Promise.all([
      spendingTotal(db, scope),
      incomeTotal(db, scope),
      spendingChange(db, scope, ctx),
      kept(db, scope),
      waitingInScope(db, bare),
      entriesInScope(db, bare),
    ]);
    return { currency: profile.currency, locale: profile.locale, today: ctx.today, firstDay: ctx.firstDay, period, preset: period.preset, presets: availablePresets(ctx.profile), scope, scopeParts: scopeParts(selection.filters, names), filterChips: filterChips(selection.filters, names), spent, income, change, kept: keptV, waiting, entries };
  },
  async loadCategories(selection) {
    const r = await resolveSelection(selection);
    const profile = await readProfile(getServices().db);
    if (!r || !profile) return null;
    const scope: InsightsScope = { period: r.period, filters: selection.filters };
    const byCategory = await spendingByCategory(r.db, scope);
    const total = await spendingTotal(r.db, scope);
    return { currency: profile.currency, locale: profile.locale, byCategory, total, view: categoryView(byCategory.rows), scopeParts: scopeParts(selection.filters, await filterNames(selection.filters, r.period)) };
  },
  async loadTrend(selection, granularity) {
    const r = await resolveSelection(selection);
    const profile = await readProfile(getServices().db);
    if (!r || !profile) return null;
    return { currency: profile.currency, locale: profile.locale, trend: await spendingTrend(r.db, { period: r.period, filters: selection.filters }, r.ctx, granularity) };
  },
  async loadOnTrack(selection) {
    const r = await resolveSelection(selection);
    const profile = await readProfile(getServices().db);
    if (!r || !profile) return null;
    return { currency: profile.currency, locale: profile.locale, thisMonth: r.ctx.today.slice(0, 7), track: await onTrack(r.db, { period: r.period, filters: selection.filters }, r.ctx, systemClock.nowMs()) };
  },
  async loadMerchants(selection) {
    const r = await resolveSelection(selection);
    const profile = await readProfile(getServices().db);
    if (!r || !profile) return null;
    return { currency: profile.currency, locale: profile.locale, merchants: await spendingByMerchant(r.db, { period: r.period, filters: selection.filters }), scopeParts: scopeParts(selection.filters, await filterNames(selection.filters, r.period)) };
  },
  async loadInOut(selection) {
    const r = await resolveSelection(selection);
    const profile = await readProfile(getServices().db);
    if (!r || !profile) return null;
    return { currency: profile.currency, locale: profile.locale, inOut: await incomeVsExpense(r.db, { period: r.period, filters: selection.filters }, r.ctx) };
  },
  async loadFacets(selection) {
    const r = await resolveSelection(selection);
    if (!r) return null;
    const { db, period } = r;
    const accounts = mapAccountRows(await db.query(ACCOUNT_LIST_SQL)).filter((a) => a.status === 'active').map((a) => ({ id: a.id, name: a.name }));
    const categories = (await db.query("SELECT id, name FROM category WHERE parent_id IS NULL AND archived = 0 AND id <> 'cat_uncategorised' ORDER BY sort_order, name")).map((x) => ({ id: String(x[0]), name: String(x[1]) }));
    const facets = await filterFacets(db, { start: period.start, end: period.end });
    return { accounts, categories, merchants: await merchantsSeen(period.start, period.end), tags: facets.tags, sources: facets.sources };
  },
};

export async function filterNames(filters: InsightsFilters, period: InsightsPeriod): Promise<FilterNames> {
  const db = getServices().db;
  const accounts: Record<string, string> = {};
  for (const a of mapAccountRows(await db.query(ACCOUNT_LIST_SQL))) accounts[a.id] = a.name;
  const categories: Record<string, string> = {};
  for (const x of await db.query('SELECT id, name FROM category')) categories[String(x[0])] = String(x[1]);
  const merchants: Record<string, string> = {};
  if (filters.merchantKeys && filters.merchantKeys.length > 0) for (const m of await merchantsSeen(period.start, period.end)) merchants[m.key] = m.name;
  return { accounts, categories, merchants };
}
