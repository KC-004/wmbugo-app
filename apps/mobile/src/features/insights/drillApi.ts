import { Share } from 'react-native';
import { buildDrillCsv, csvFileName, drillDown, type ActivityQuery, type CurrencyCode, type DrillDown, type DrillTarget, type InsightsFilters } from '@wmbugo/core';
import { getServices } from '../../adapters/startApp';
import { readProfile } from '../../adapters/readProfile';
import { copy } from '../../shared/copy';
import { filterNames, resolveSelection, scopeParts, type FilterNames, type InsightsSelection } from './insightsApi';

const i = copy.insights;

export interface DrillData {
  readonly drill: DrillDown;
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly exponent: number;
  readonly today: string;
  readonly timezoneId: string;
  /** `Account HDFC; Category Food`, or empty. */
  readonly filtersText: string;
  /** The scope words for the active filters (`HDFC only`). */
  readonly scopeParts: readonly string[];
}

/** What the drill-down needs. The real one goes through core; tests pass a fake. */
export interface DrillApi {
  loadDrill(selection: InsightsSelection, target: DrillTarget): Promise<DrillData | null>;
}

/** Saves a CSV the user asked for. `cancelled` writes nothing. */
export interface CsvSaver {
  save(fileName: string, text: string): Promise<'saved' | 'cancelled' | 'failed'>;
}

export const drillKey = (selection: InsightsSelection, target: DrillTarget) => ['insights', 'drill', selection, target] as const;

/** `Account HDFC; Category Food`: the filters in words, for the CSV header. */
export function filtersText(filters: InsightsFilters, names: FilterNames): string {
  const out: string[] = [];
  for (const v of filters.accountIds ?? []) out.push(i.filterAccountText.replace('{name}', names.accounts[v] ?? v));
  for (const v of filters.categoryIds ?? []) out.push(i.filterCategoryText.replace('{name}', names.categories[v] ?? v));
  for (const v of filters.merchantKeys ?? []) out.push(i.filterMerchantText.replace('{name}', names.merchants[v] ?? v));
  for (const v of filters.types ?? []) out.push(i.filterTypeText.replace('{name}', v === 'expense' ? i.typeExpense : v === 'income' ? i.typeIncome : i.typeRefund));
  for (const v of filters.tags ?? []) out.push(i.filterTagText.replace('{name}', v));
  for (const v of filters.sources ?? []) out.push(i.filterSourceText.replace('{name}', i.sourceNames[v as keyof typeof i.sourceNames] ?? v));
  return out.join('; ');
}

export const realDrillApi: DrillApi = {
  async loadDrill(selection, target) {
    const r = await resolveSelection(selection);
    const profile = await readProfile(getServices().db);
    if (!r || !profile) return null;
    const { db, ctx, period } = r;
    const names = await filterNames(selection.filters, period);
    const drill = await drillDown(db, { period, filters: selection.filters }, target, ctx);
    return { drill, currency: profile.currency, locale: profile.locale, exponent: profile.exponent, today: ctx.today, timezoneId: ctx.timezoneId, filtersText: filtersText(selection.filters, names), scopeParts: scopeParts(selection.filters, names) };
  },
};

/** The CSV text and file name for a loaded drill-down. */
export function csvFor(d: DrillData, title: string): { fileName: string; text: string } {
  return {
    fileName: csvFileName(title, d.drill.scope.start, d.drill.scope.end),
    text: buildDrillCsv(d.drill, { timezoneId: d.timezoneId, currencyCode: d.currency, exponent: d.exponent, filtersText: d.filtersText }),
  };
}

/**
 * Hands the CSV to the system share sheet, so the person chooses where it goes (Files, Drive, email). Nothing is sent by wmbugo
 * and no permission is needed. The Android save dialog (Storage Access Framework) needs a native module this app does not have
 * yet; this stands in for it behind the same port.
 */
export const shareCsvSaver: CsvSaver = {
  async save(fileName, text) {
    try {
      const r = await Share.share({ title: fileName, message: text });
      return r.action === Share.dismissedAction ? 'cancelled' : 'saved';
    } catch {
      return 'failed';
    }
  },
};

/** The Activity filter that lists the same entries as a drill-down (Story 3.6 filters). */
export function activityQueryFor(d: DrillData, categoryIds: readonly string[] | undefined): ActivityQuery {
  const f = d.drill.scope.filters;
  return {
    fromDate: d.drill.scope.start,
    toDate: d.drill.scope.end,
    ...(f.accountIds?.length ? { accountIds: f.accountIds } : {}),
    ...(categoryIds?.length ? { categoryIds } : f.categoryIds?.length ? { categoryIds: f.categoryIds } : {}),
    types: d.drill.mode === 'income' ? ['income'] : ['expense', 'refund'],
  };
}
