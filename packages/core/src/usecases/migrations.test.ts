import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { sha256Hex } from '../shared/sha256';
import { FakeSqlDatabase } from './fakes';
import { loadMigrations, runMigrations, type BundledMigrations } from './migrations';

const SQL1 = 'CREATE TABLE `schema_migration` (\n\t`version` integer PRIMARY KEY NOT NULL\n);';
const SQL2 = 'CREATE TABLE `audit_event` (`id` text);\n--> statement-breakpoint\nCREATE TABLE `outbox` (`id` text);';

const bundle = (second = SQL2): BundledMigrations => ({
  journal: { entries: [{ idx: 0, tag: '0000_a' }, { idx: 1, tag: '0001_b' }] },
  migrations: { m0000: SQL1, m0001: second },
});

describe('sha256Hex', () => {
  it('matches known vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches node crypto for arbitrary unicode strings and block boundaries', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (s) => sha256Hex(s) === createHash('sha256').update(s, 'utf8').digest('hex')),
      { numRuns: 500 },
    );
    for (const n of [55, 56, 63, 64, 65, 119, 120, 128]) {
      const s = 'x'.repeat(n);
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s).digest('hex'));
    }
  });
});

describe('loadMigrations', () => {
  it('orders, splits on breakpoints and checksums', () => {
    const r = loadMigrations(bundle());
    expect(r.ok && r.value.map((m) => [m.version, m.tag, m.statements.length])).toEqual([
      [1, '0000_a', 1],
      [2, '0001_b', 2],
    ]);
    expect(r.ok && r.value[0]!.checksum).toBe(sha256Hex(SQL1));
  });

  it('rejects gaps, missing SQL and empty SQL', () => {
    expect(loadMigrations({ journal: { entries: [{ idx: 1, tag: 'x' }] }, migrations: { m0001: 'A' } })).toEqual({ ok: false, code: 'MIGRATION_BUNDLE_INVALID' });
    expect(loadMigrations({ journal: { entries: [{ idx: 0, tag: 'x' }] }, migrations: {} })).toEqual({ ok: false, code: 'MIGRATION_BUNDLE_INVALID' });
    expect(loadMigrations({ journal: { entries: [{ idx: 0, tag: 'x' }] }, migrations: { m0000: '  ' } })).toEqual({ ok: false, code: 'MIGRATION_BUNDLE_INVALID' });
  });

  it('accepts an empty journal', () => {
    expect(loadMigrations({ journal: { entries: [] }, migrations: {} })).toEqual({ ok: true, value: [] });
  });
});

describe('runMigrations', () => {
  const load = (b = bundle()) => {
    const r = loadMigrations(b);
    if (!r.ok) throw new Error('setup');
    return r.value;
  };

  it('applies everything on a fresh database in one transaction with no safety copy (nothing to protect), recording each version', async () => {
    const db = new FakeSqlDatabase();
    const r = await runMigrations(db, load(), () => 1234);
    expect(r).toEqual({ ok: true, value: { appliedVersions: [1, 2], currentVersion: 2 } });
    expect(db.safetyCopies).toEqual([]);
    expect(db.migrationRows.map((x) => [x.version, x.tag, x.applied_at])).toEqual([[1, '0000_a', 1234], [2, '0001_b', 1234]]);
    expect([...db.tables].sort()).toEqual(['audit_event', 'outbox', 'schema_migration']);
    expect(db.writes).toBe(1); // one transaction for all pending migrations
  });

  it('is a no-op (and takes no safety copy) when already current', async () => {
    const db = new FakeSqlDatabase();
    await runMigrations(db, load(), () => 1);
    const again = await runMigrations(db, load(), () => 2);
    expect(again).toEqual({ ok: true, value: { appliedVersions: [], currentVersion: 2 } });
    expect(db.safetyCopies).toHaveLength(0);
    expect(db.writes).toBe(1);
  });

  it('applies only the new migration to an older database', async () => {
    const db = new FakeSqlDatabase();
    await runMigrations(db, load({ ...bundle(), journal: { entries: [{ idx: 0, tag: '0000_a' }] } }), () => 1);
    const r = await runMigrations(db, load(), () => 2);
    expect(r).toEqual({ ok: true, value: { appliedVersions: [2], currentVersion: 2 } });
    expect(db.safetyCopies).toEqual(['before-v2']);
  });

  it('fault injection: a throwing migration rolls everything back and keeps the safety copy', async () => {
    const db = new FakeSqlDatabase();
    await runMigrations(db, load({ ...bundle(), journal: { entries: [{ idx: 0, tag: '0000_a' }] } }), () => 1);
    const before = { tables: [...db.tables], rows: [...db.migrationRows] };

    const r = await runMigrations(db, load(bundle('CREATE TABLE `audit_event` (`id` text);\n--> statement-breakpoint\nFAIL now')), () => 2);

    expect(r).toEqual({ ok: false, code: 'MIGRATION_FAILED' });
    expect([...db.tables]).toEqual(before.tables); // audit_event was created inside the failed transaction: gone
    expect(db.migrationRows).toEqual(before.rows); // still at the previous version
    expect(db.safetyCopies).toEqual(['before-v2']); // copy taken and kept
  });

  it('fault injection: a failing safety copy stops before any write', async () => {
    const db = new FakeSqlDatabase();
    await runMigrations(db, load({ ...bundle(), journal: { entries: [{ idx: 0, tag: '0000_a' }] } }), () => 1);
    db.failSafetyCopy = true;
    const r = await runMigrations(db, load(), () => 2);
    expect(r).toEqual({ ok: false, code: 'MIGRATION_FAILED' });
    expect(db.writes).toBe(1); // only the first migration's write
    expect(db.tables.has('audit_event')).toBe(false);
  });

  it('refuses an edited migration that was already applied', async () => {
    const db = new FakeSqlDatabase();
    await runMigrations(db, load(), () => 1);
    const r = await runMigrations(db, load(bundle('CREATE TABLE `outbox` (`id` text, `x` text);')), () => 2);
    expect(r).toEqual({ ok: false, code: 'MIGRATION_CHECKSUM_MISMATCH' });
  });

  it('refuses a database that is newer than the app', async () => {
    const db = new FakeSqlDatabase();
    await runMigrations(db, load(), () => 1);
    const r = await runMigrations(db, load({ ...bundle(), journal: { entries: [{ idx: 0, tag: '0000_a' }] } }), () => 2);
    expect(r).toEqual({ ok: false, code: 'DATABASE_NEWER_THAN_APP' });
  });
});
