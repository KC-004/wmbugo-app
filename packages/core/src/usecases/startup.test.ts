import { FakeClock } from '../shared/clock';
import { seededRandom } from '../shared/uuid';
import { captureLogger, FakeKeyStore, FakeOpener, FakeSqlDatabase } from './fakes';
import { loadOrCreateKey, startStorage, type StartupDeps } from './startup';
import type { BundledMigrations } from './migrations';

const MIGRATIONS: BundledMigrations = {
  journal: { entries: [{ idx: 0, tag: '0000_schema_migration' }] },
  migrations: { m0000: 'CREATE TABLE `schema_migration` (`version` integer PRIMARY KEY NOT NULL);' },
};

function setup(overrides: Partial<StartupDeps> = {}) {
  const db = new FakeSqlDatabase();
  const keyStore = new FakeKeyStore();
  const opener = new FakeOpener(db);
  const log = captureLogger();
  const deps: StartupDeps = {
    keyStore,
    random: seededRandom(42),
    opener,
    migrations: MIGRATIONS,
    clock: new FakeClock(1000),
    logger: log.logger,
    ...overrides,
  };
  return { db, keyStore, opener, log, deps };
}

describe('loadOrCreateKey', () => {
  it('creates a random 256-bit hex key on first launch and stores it', async () => {
    const ks = new FakeKeyStore();
    const r = await loadOrCreateKey(ks, seededRandom(1));
    expect(r.ok && r.value).toMatch(/^[0-9a-f]{64}$/);
    expect(ks.key).toBe(r.ok ? r.value : null);
    expect(ks.sets).toBe(1);
  });

  it('reuses the stored key and never regenerates', async () => {
    const ks = new FakeKeyStore();
    ks.key = 'a'.repeat(64);
    const r = await loadOrCreateKey(ks, seededRandom(1));
    expect(r).toEqual({ ok: true, value: 'a'.repeat(64) });
    expect(ks.sets).toBe(0);
  });

  it('different seeds give different keys', async () => {
    const a = await loadOrCreateKey(new FakeKeyStore(), seededRandom(1));
    const b = await loadOrCreateKey(new FakeKeyStore(), seededRandom(2));
    expect(a).not.toEqual(b);
  });

  it.each([
    ['keystore throws', (k: FakeKeyStore) => { k.throwOnGet = true; }],
    ['keystore refuses to store', (k: FakeKeyStore) => { k.refuseSet = true; }],
    ['stored key is malformed', (k: FakeKeyStore) => { k.key = 'not-a-key'; }],
  ])('KEY_UNAVAILABLE when %s', async (_n, arrange) => {
    const ks = new FakeKeyStore();
    arrange(ks);
    expect(await loadOrCreateKey(ks, seededRandom(1))).toEqual({ ok: false, code: 'KEY_UNAVAILABLE' });
  });

  it('rejects a random source that returns the wrong length', async () => {
    const short = { bytes: () => new Uint8Array(8) };
    expect(await loadOrCreateKey(new FakeKeyStore(), short)).toEqual({ ok: false, code: 'KEY_UNAVAILABLE' });
  });
});

describe('startStorage', () => {
  it('first launch: creates the key, opens, migrates, and routes to onboarding', async () => {
    const { db, keyStore, opener, deps } = setup();
    const r = await startStorage(deps);
    expect(r.ok && r.value.route).toBe('onboarding');
    expect(opener.openedWith).toEqual([keyStore.key]);
    expect(db.tables.has('schema_migration')).toBe(true);
    expect(db.migrationRows).toHaveLength(1);
  });

  it('second launch: reuses the key, applies nothing, routes home when a profile exists', async () => {
    const { db, keyStore, opener, deps } = setup();
    await startStorage(deps);
    db.tables.add('profile');
    db.profileRows = 1;
    const firstKey = keyStore.key;
    const r = await startStorage(deps);
    expect(r.ok && r.value.route).toBe('home');
    expect(opener.openedWith).toEqual([firstKey, firstKey]);
    expect(db.safetyCopies).toHaveLength(0);
  });

  it('routes to onboarding when the profile table exists but is empty', async () => {
    const { db, deps } = setup();
    db.tables.add('profile');
    const r = await startStorage(deps);
    expect(r.ok && r.value.route).toBe('onboarding');
  });

  it('refuses to continue when SQLCipher is missing, with no writes and no safety copy', async () => {
    for (const cipher of [null, '', '   ']) {
      const { db, deps } = setup();
      db.cipher = cipher;
      expect(await startStorage(deps)).toEqual({ ok: false, code: 'STORAGE_UNSAFE' });
      expect(db.writes).toBe(0);
      expect(db.safetyCopies).toHaveLength(0);
      expect(db.tables.size).toBe(0);
      expect(db.closed).toBe(true);
    }
  });

  it('treats a throwing cipher check as unsafe', async () => {
    const { db, deps } = setup();
    db.cipherVersion = () => Promise.reject(new Error('boom'));
    expect(await startStorage(deps)).toEqual({ ok: false, code: 'STORAGE_UNSAFE' });
    expect(db.writes).toBe(0);
  });

  it('DATABASE_OPEN_FAILED when the file cannot be opened', async () => {
    const { opener, deps } = setup();
    opener.failOpen = true;
    expect(await startStorage(deps)).toEqual({ ok: false, code: 'DATABASE_OPEN_FAILED' });
  });

  it('a missing key with an existing database is KEY_UNAVAILABLE: no new key is created or stored', async () => {
    const { keyStore, opener, db, deps } = setup();
    opener.fileExists = true;
    expect(await startStorage(deps)).toEqual({ ok: false, code: 'KEY_UNAVAILABLE' });
    expect(keyStore.sets).toBe(0);
    expect(keyStore.key).toBeNull();
    expect(opener.openedWith).toHaveLength(0);
    expect(db.writes).toBe(0);
  });

  it('an existing database with its key opens normally', async () => {
    const { keyStore, opener, deps } = setup();
    keyStore.key = 'c'.repeat(64);
    opener.fileExists = true;
    const r = await startStorage(deps);
    expect(r.ok).toBe(true);
    expect(opener.openedWith).toEqual(['c'.repeat(64)]);
  });

  it('a key that does not match the file (reads fail) is DATABASE_OPEN_FAILED, closed, nothing written', async () => {
    const { db, opener, deps } = setup();
    opener.fileExists = true;
    db.throwOnQuery = true;
    expect((await startStorage({ ...deps, keyStore: Object.assign(new FakeKeyStore(), { key: 'd'.repeat(64) }) }))).toEqual({
      ok: false,
      code: 'DATABASE_OPEN_FAILED',
    });
    expect(db.closed).toBe(true);
    expect(db.writes).toBe(0);
  });

  it('DATABASE_OPEN_FAILED when checking for the file throws', async () => {
    const { opener, deps } = setup();
    opener.exists = () => Promise.reject(new Error('io'));
    expect(await startStorage(deps)).toEqual({ ok: false, code: 'DATABASE_OPEN_FAILED' });
  });

  it('KEY_UNAVAILABLE stops before opening anything', async () => {
    const { keyStore, opener, deps } = setup();
    keyStore.throwOnGet = true;
    expect(await startStorage(deps)).toEqual({ ok: false, code: 'KEY_UNAVAILABLE' });
    expect(opener.openedWith).toHaveLength(0);
  });

  it('a failing migration returns MIGRATION_FAILED, closes the database and keeps it unchanged', async () => {
    const { db, deps } = setup({ migrations: { journal: { entries: [{ idx: 0, tag: 'bad' }] }, migrations: { m0000: 'FAIL' } } });
    expect(await startStorage(deps)).toEqual({ ok: false, code: 'MIGRATION_FAILED' });
    expect(db.tables.size).toBe(0);
    expect(db.closed).toBe(true);
  });

  it('an invalid bundle fails before any write', async () => {
    const { db, deps } = setup({ migrations: { journal: { entries: [{ idx: 0, tag: 'x' }] }, migrations: {} } });
    expect(await startStorage(deps)).toEqual({ ok: false, code: 'MIGRATION_BUNDLE_INVALID' });
    expect(db.writes).toBe(0);
  });

  it('never logs the database key, on success or on any failure path', async () => {
    const scenarios: ((s: ReturnType<typeof setup>) => void)[] = [
      () => undefined,
      (s) => { s.db.cipher = ''; },
      (s) => { s.opener.failOpen = true; },
      (s) => { s.deps = { ...s.deps, migrations: { journal: { entries: [{ idx: 0, tag: 'bad' }] }, migrations: { m0000: 'FAIL' } } }; },
    ];
    for (const arrange of scenarios) {
      const s = setup() as ReturnType<typeof setup> & { deps: StartupDeps };
      arrange(s);
      await startStorage(s.deps);
      const key = s.keyStore.key;
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(s.log.entries)).not.toContain(key as string);
      expect(JSON.stringify(s.log.entries)).not.toMatch(/[0-9a-f]{32,}/);
    }
  });

  it('logs only event names and non-sensitive counts', async () => {
    const { log, deps } = setup();
    await startStorage(deps);
    expect(log.entries.map((e) => e.event)).toEqual(['startup.ready']);
    expect(log.entries[0]!.fields).toEqual({ route: 'onboarding', migrationsApplied: 1 });
  });
});
