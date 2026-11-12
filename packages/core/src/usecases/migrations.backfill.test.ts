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

/** The tag of the migration that fills category_guessed and category_set_by for entries that already exist (Story 4.4). */
const BACKFILL_TAG = '0018_category_guess_backfill_apply';

describe('the category guess backfill runs on entries that already exist (Story 4.4, Epic 4 review)', () => {
  it('auto-approved categorised entries become guesses; every other categorised entry becomes the user\'s; entries still to categorise stay unset', async () => {
    const db = new NodeSqliteDatabase();
    db.raw.exec('PRAGMA foreign_keys = ON');
    const at = journal.entries.findIndex((e) => e.tag === BACKFILL_TAG);
    expect(at).toBeGreaterThan(0);
    const before = loadMigrations(bundleUpTo(at));
    if (!before.ok) throw new Error('bundle');
    expect((await runMigrations(db, before.value, () => 1)).ok).toBe(true);

    const row = (id: string, resolution: string, needs: number) =>
      db.raw.exec(
        `INSERT INTO "transaction" (id,event_type,status,amount_minor,occurred_at_utc,local_date,timezone_id,tags_json,needs_category,created_at,updated_at,capture_resolution) VALUES ('${id}','expense','confirmed',5,1,'2026-11-08','UTC','[]',${needs},1,1,'${resolution}')`,
      );
    row('guessed', 'auto_approved', 0);
    row('typed', 'user_approved', 0);
    row('open', 'auto_approved', 1);

    const all = loadMigrations(bundleUpTo(journal.entries.length));
    if (!all.ok) throw new Error('bundle');
    expect((await runMigrations(db, all.value, () => 2)).ok).toBe(true);

    const state = async (id: string) => (await db.query('SELECT category_guessed, category_set_by FROM "transaction" WHERE id = ?', [id]))[0]!.map((v) => (v === null ? null : typeof v === 'number' ? v : String(v)));
    expect(await state('guessed')).toEqual([1, 'suggester']);
    expect(await state('typed')).toEqual([0, 'user']);
    expect(await state('open')).toEqual([0, null]);
  });
});
