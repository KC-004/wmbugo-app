/**
 * The CSV writer (Story 7.3, INS-006): one place for escaping, so Insights and the exports of Epic 9 write cells the same safe
 * way. A cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return would run as a formula in a spreadsheet, so it
 * is prefixed with a single quote. Commas, quotes and line breaks are quoted. Lines end with a line feed.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvRow = (cells: readonly (string | number | null | undefined)[]): string => cells.map(csvCell).join(',');

/** The `# ...` header lines, then the column row, then one row per record. */
export function buildCsv(headerLines: readonly string[], columns: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return [...headerLines, csvRow(columns), ...rows.map(csvRow)].join('\n') + '\n';
}
