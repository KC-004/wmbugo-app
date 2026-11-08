import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { loadMigrations, runMigrations, type BundledMigrations } from './migrations';

const dir = resolve(__dirname, '../../../../apps/mobile/drizzle');
const journal = JSON.parse(readFileSync(resolve(dir, 'meta/_journal.json'), 'utf8')) as BundledMigrations['journal'];
const bundleUpTo = (count: number): BundledMigrations => {
  const entries = journal.entries.slice(0, count);
  return { journal: { entries }, migrations: Object.fromEntries(entries.map((e) => [`m${String(e.idx).padStart(4, '0')}`, readFileSync(resolve(dir, `${e.tag}.sql`), 'utf8')])) };
};

describe('a migration that rebuilds a table runs on a database that already has rows (Story 3.2)', () => {
  it('keeps every transaction, posting and split, leaves foreign keys on, and passes the foreign key check', async () => {
    const db = new NodeSqliteDatabase();
    db.raw.exec('PRAGMA foreign_keys = ON');
    const before = loadMigrations(bundleUpTo(journal.entries.length - 1));
    if (!before.ok) throw new Error('bundle');
    expect((await runMigrations(db, before.value, () => 1)).ok).toBe(true);

    db.raw.exec("INSERT INTO account (id,name,type,icon,color_token,opening_minor,opening_effective_at,balance_not_set,include_in_overview,sort_order,status,created_at,updated_at) VALUES ('a','A','bank','Bank','cat-indigo',100,1,0,1,0,'active',1,1)");
    db.raw.exec("INSERT INTO \"transaction\" (id,event_type,status,amount_minor,occurred_at_utc,local_date,timezone_id,tags_json,needs_category,created_at,updated_at) VALUES ('t','expense','confirmed',5,1,'2026-11-08','UTC','[]',0,1,1)");
    db.raw.exec("INSERT INTO posting (id,transaction_id,account_id,direction,signed_amount_minor,posting_kind) VALUES ('p','t','a','out',-5,'normal')");
    db.raw.exec("INSERT INTO split (id,transaction_id,category_id,amount_minor) VALUES ('s','t','cat_food',5)");

    const all = loadMigrations(bundleUpTo(journal.entries.length));
    if (!all.ok) throw new Error('bundle');
    expect(await runMigrations(db, all.value, () => 2)).toMatchObject({ ok: true });

    expect(Number((await db.query('SELECT COUNT(*) FROM "transaction"'))[0]![0])).toBe(1);
    expect(Number((await db.query('SELECT COUNT(*) FROM posting'))[0]![0])).toBe(1);
    expect(Number((await db.query('SELECT COUNT(*) FROM split'))[0]![0])).toBe(1);
    expect(await db.query('PRAGMA foreign_key_check')).toEqual([]);
    expect(Number((await db.query('PRAGMA foreign_keys'))[0]![0])).toBe(1);
    // the new statuses are accepted
    db.raw.exec("INSERT INTO \"transaction\" (id,event_type,status,amount_minor,occurred_at_utc,local_date,timezone_id,tags_json,needs_category,created_at,updated_at) VALUES ('x','expense','excluded',5,1,'2026-11-08','UTC','[]',0,1,1)");
  });
});
