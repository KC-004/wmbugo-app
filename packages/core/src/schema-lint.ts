/**
 * Schema lint (Story 1.5). Core never imports Drizzle, so schema files are
 * checked as text: one Drizzle `sqliteTable('name', { col: type('col_name') ... })`
 * declaration per table. Returns a list of human-readable violations.
 */

/** Keyed lookup tables that are exempt from the "text('id') primary key" rule. */
export const KEYED_TABLES: ReadonlySet<string> = new Set([
  'settings',
  'prompt_state',
  'schema_migration',
  'sms_cursor',
  'balance_chain',
  'budget_alert_fired',
]);

/** Integer columns that look monetary by name but are not money. */
export const NON_MONEY_INTEGERS: ReadonlySet<string> = new Set([
  'size_bytes',
  'threshold_pct',
  'match_score_pct',
  'confidence_pct',
  'qty',
  'currency_exponent',
  'balance_not_set',
  'foreign_currency_exponent',
]);

const MONEY_WORD = /(amount|balance|price|total|limit|target|due|opening|spent|income|tolerance)/;

interface Column {
  table: string;
  property: string;
  type: string;
  name: string;
  primaryKey: boolean;
}

function parseColumns(source: string): Column[] {
  const cols: Column[] = [];
  let table = '';
  for (const line of source.split('\n')) {
    const t = /sqliteTable\(\s*['"]([a-z0-9_]+)['"]/.exec(line);
    if (t) table = t[1]!;
    const c = /^\s*([A-Za-z0-9_]+)\s*:\s*(integer|text|real|numeric|blob)\(\s*['"]([a-z0-9_]+)['"]/.exec(line);
    if (c && table) {
      cols.push({ table, property: c[1]!, type: c[2]!, name: c[3]!, primaryKey: /\.primaryKey\(/.test(line) });
    }
  }
  return cols;
}

export function lintSchemaSource(source: string, file = 'schema'): string[] {
  const problems: string[] = [];
  const at = (c: Column): string => `${file}: ${c.table}.${c.name}`;

  for (const c of parseColumns(source)) {
    if (c.type === 'real' || c.type === 'numeric') {
      problems.push(`${at(c)} uses ${c.type}(); money and counts are INTEGER, never floating point`);
    }
    if (c.type === 'blob') problems.push(`${at(c)} uses blob(); store money as INTEGER _minor columns`);
    if (c.name.endsWith('_minor') && c.type !== 'integer') {
      problems.push(`${at(c)} ends _minor but is ${c.type}; money columns are INTEGER`);
    }
    if (
      c.type === 'integer' &&
      MONEY_WORD.test(c.name) &&
      !c.name.endsWith('_minor') &&
      !NON_MONEY_INTEGERS.has(c.name) &&
      !c.name.endsWith('_at') &&
      !c.name.endsWith('_pct')
    ) {
      problems.push(`${at(c)} looks like money but does not end _minor`);
    }
    if ((c.name.endsWith('_at') || c.name.endsWith('_at_utc')) && c.type !== 'integer') {
      problems.push(`${at(c)} is an instant and must be INTEGER UTC epoch ms`);
    }
    if (c.primaryKey && !KEYED_TABLES.has(c.table) && !(c.name === 'id' && c.type === 'text')) {
      problems.push(`${at(c)} is a primary key but not text('id') (UUID v7); add the table to KEYED_TABLES only for lookup tables`);
    }
  }
  return problems;
}
