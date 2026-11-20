import { buildCsv } from '../shared/csv';
import { formatMinorPlain } from '../shared/money';
import type { DrillDown } from './drilldown';

/**
 * The CSV of a drill-down (Story 7.3, INS-006): the user's own entries behind a figure, in a file they keep. The amount is an
 * unsigned decimal and the type carries the direction. The writer lives in `shared/csv`, so Epic 9's exports reuse it. Pure
 * text: saving it is the app's job, and nothing here touches the network.
 */

export const INSIGHTS_CSV_SCHEMA = 'wmbugo-insights-1';

export interface CsvInfo {
  readonly timezoneId: string;
  readonly currencyCode: string;
  readonly exponent: number;
  /** `Account HDFC; Category Food`, or empty for no filters. */
  readonly filtersText: string;
}

/** `wmbugo-food-2026-11-01-to-2026-11-30.csv`. */
export function csvFileName(name: string, startDate: string, endDate: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'spending';
  return `wmbugo-${slug}-${startDate}-to-${endDate}.csv`;
}

export const CSV_COLUMNS = ['date', 'merchant', 'category', 'account', 'type', 'amount', 'currency', 'note'] as const;

export function buildDrillCsv(drill: DrillDown, info: CsvInfo): string {
  const rows: (string | number | null)[][] = [];
  for (const day of drill.days) {
    for (const e of day.entries) {
      const amount = formatMinorPlain(e.amountMinor, info.exponent);
      rows.push([e.localDate, e.merchant, e.categoryName, e.accountName, e.type, amount.ok ? amount.value : '', info.currencyCode, '']);
    }
  }
  return buildCsv(
    [`# Period ${drill.scope.start} to ${drill.scope.end} (inclusive)`, `# Filters: ${info.filtersText === '' ? 'none' : info.filtersText}`, `# Timezone ${info.timezoneId}`, `# Currency ${info.currencyCode}`, `# Schema ${INSIGHTS_CSV_SCHEMA}`],
    CSV_COLUMNS,
    rows,
  );
}

