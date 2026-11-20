import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The Insights module's boundaries (Story 7.1, AD-3, AD-7). The Home read models from Epic 5 and 6 predate this rule. */
const LEGACY = new Set(['homeSummary', 'homeCards', 'homeCharts', 'freeToUse', 'homeBillsGoals', 'index']);
const files = readdirSync(__dirname)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !LEGACY.has(f.replace(/\.ts$/, '')))
  .map((f) => ({ name: f, text: readFileSync(join(__dirname, f), 'utf8') }));

describe('the insights module boundaries (Story 7.1)', () => {
  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('does not import the capture module', () => {
    for (const f of files) expect(f.text).not.toMatch(/from '\.\.\/capture/);
  });

  it('reads no other module\'s table: tables are read through the ledger, planning and profile queries', () => {
    for (const f of files) expect(f.text).not.toMatch(/\b(FROM|JOIN)\s+("transaction"|\\"transaction\\"|split|posting|category|account|goal|goal_allocation|recurring_rule|budget|source_record)\b/);
  });

  it('does no date arithmetic on period boundaries: the period service owns them', () => {
    for (const f of files) expect(f.text).not.toMatch(/addDays\(|addMonthsClamped\(|new Date\(|Date\.UTC|setDate\(|getTime\(/);
  });

  it('uses no floating point arithmetic on money', () => {
    for (const f of files) expect(f.text).not.toMatch(/parseFloat|toFixed|Math\.random|\* 0\.\d|\.\d+\s*\*/);
  });
});
