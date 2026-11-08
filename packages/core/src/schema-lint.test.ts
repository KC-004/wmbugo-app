import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { lintSchemaSource } from './schema-lint';

const GOOD = `
export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  opening_minor: integer('opening_minor'),
  created_at: integer('created_at').notNull(),
  local_date: text('local_date').notNull(),
});
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  version: integer('version').notNull(),
});
`;

describe('schema lint (self-check: bad schemas must fail)', () => {
  it('accepts a conforming schema', () => {
    expect(lintSchemaSource(GOOD)).toEqual([]);
  });

  it('rejects real columns', () => {
    const bad = `export const t = sqliteTable('t', {\n  id: text('id').primaryKey(),\n  rate: real('rate'),\n});`;
    expect(lintSchemaSource(bad).join()).toMatch(/real\(\)/);
  });

  it('rejects numeric and blob money', () => {
    expect(lintSchemaSource(`sqliteTable('t', {\n  x: numeric('x'),\n});`)).not.toEqual([]);
    expect(lintSchemaSource(`sqliteTable('t', {\n  x: blob('x'),\n});`)).not.toEqual([]);
  });

  it('rejects a money integer without _minor', () => {
    const bad = `sqliteTable('t', {\n  id: text('id').primaryKey(),\n  amount: integer('amount').notNull(),\n});`;
    expect(lintSchemaSource(bad).join()).toMatch(/t\.amount .*_minor/);
  });

  it('rejects _minor columns that are not INTEGER', () => {
    const bad = `sqliteTable('t', {\n  id: text('id').primaryKey(),\n  amount_minor: text('amount_minor'),\n});`;
    expect(lintSchemaSource(bad).join()).toMatch(/ends _minor but is text/);
  });

  it('rejects non-integer instants', () => {
    const bad = `sqliteTable('t', {\n  id: text('id').primaryKey(),\n  created_at: text('created_at'),\n});`;
    expect(lintSchemaSource(bad).join()).toMatch(/instant/);
  });

  it('rejects a non-UUID primary key outside the keyed-table allowlist', () => {
    const bad = `sqliteTable('account', {\n  id: integer('id').primaryKey(),\n});`;
    expect(lintSchemaSource(bad).join()).toMatch(/primary key/);
    const bad2 = `sqliteTable('account', {\n  code: text('code').primaryKey(),\n});`;
    expect(lintSchemaSource(bad2).join()).toMatch(/primary key/);
  });

  it('allows documented non-money integers', () => {
    const ok = `sqliteTable('attachment', {\n  id: text('id').primaryKey(),\n  size_bytes: integer('size_bytes'),\n  threshold_pct: integer('threshold_pct'),\n  currency_exponent: integer('currency_exponent'),\n});`;
    expect(lintSchemaSource(ok)).toEqual([]);
  });

  it('ignores columns before any table and comments', () => {
    expect(lintSchemaSource(`// amount: real('amount')\nconst x = 1;`)).toEqual([]);
  });
});

function schemaFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...schemaFiles(p));
    else if (/\.schema\.ts$/.test(name)) out.push(p);
  }
  return out;
}

describe('schema lint (real schema files)', () => {
  const root = resolve(__dirname, '../../../apps/mobile/src');
  const files = schemaFiles(root);

  it('every Drizzle schema file (*.schema.ts) under apps/mobile/src conforms', () => {
    const problems = files.flatMap((f) => lintSchemaSource(readFileSync(f, 'utf8'), f));
    expect(problems).toEqual([]);
  });
});
