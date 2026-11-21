import { err, ok } from '../shared/result';
import type { Crypto } from '../ports/crypto';
import { createSodiumCrypto } from '../testing/sodiumCrypto';
import { DB_NAME, concat, utf8Decode, utf8Encode } from './format';
import type { ByteSource } from './reader';
import {
  RESTORE_REVERTED_MESSAGE,
  recoverRestore,
  restoreBackup,
  type Maintenance,
  type RestoreDb,
  type RestoreDeps,
  type RestoreFs,
  type RestoreLayout,
  type StagedChecks,
} from './restore';
import { writeBackup, type BackupEntrySource } from './writer';

let crypto: Crypto;
beforeAll(async () => {
  crypto = await createSodiumCrypto();
});

const L: RestoreLayout = {
  dbPath: 'live/wmbugo.db',
  attachmentsDir: 'live/receipts',
  stagingDir: 'priv/staging',
  stagingDb: 'priv/staging/new.db',
  stagingAttachmentsDir: 'priv/staging/receipts',
  safetyDir: 'priv/safety',
  journalPath: 'priv/restore.journal',
};

/** An in-memory file system. `killAfter(n)` freezes it after n mutations, like a process killed mid-restore. */
class MemFs implements RestoreFs {
  files = new Map<string, string>();
  free = 10_000_000;
  mutations = 0;
  private limit: number | null = null;
  private dead = false;
  killAfter(n: number | null) {
    this.limit = n;
    this.mutations = 0;
    this.dead = false;
  }
  revive() {
    this.limit = null;
    this.dead = false;
  }
  private guard(): void {
    if (this.dead) throw new Error('process killed');
  }
  private mutate(): void {
    this.guard();
    if (this.limit !== null && this.mutations >= this.limit) {
      this.dead = true;
      throw new Error('process killed');
    }
    this.mutations++;
  }
  private under(prefix: string) {
    return [...this.files.keys()].filter((k) => k === prefix || k.startsWith(`${prefix}/`));
  }
  async exists(path: string) {
    this.guard();
    return this.under(path).length > 0 || this.dirs.has(path);
  }
  dirs = new Set<string>();
  async rename(from: string, to: string) {
    this.mutate();
    const keys = this.under(from);
    if (keys.length === 0 && !this.dirs.has(from)) throw new Error(`no such path ${from}`);
    for (const k of keys) {
      this.files.set(to + k.slice(from.length), this.files.get(k)!);
      this.files.delete(k);
    }
    if (this.dirs.delete(from)) this.dirs.add(to);
  }
  async remove(path: string) {
    this.mutate();
    for (const k of this.under(path)) this.files.delete(k);
    for (const d of [...this.dirs]) if (d === path || d.startsWith(`${path}/`)) this.dirs.delete(d);
  }
  async makeDir(path: string) {
    this.mutate();
    this.dirs.add(path);
  }
  async readText(path: string) {
    this.guard();
    return this.files.get(path) ?? null;
  }
  async writeText(path: string, text: string) {
    this.mutate();
    this.files.set(path, text);
  }
  async freeBytes() {
    this.guard();
    return this.free;
  }
  snapshot() {
    return JSON.stringify([...this.files.entries()].sort());
  }
}

const RESTORED_DB = 'restored database contents';
const OLD_DB = 'the phone database before';
const OLD_PHOTO = 'old photo';
const PHOTO_ID = '0192a3b4-aaaa-7bbb-8ccc-000000000001';

function entry(name: string, data: Uint8Array): BackupEntrySource {
  return { name, size: data.length, sha256: crypto.sha256(data), async *read() { yield data; } };
}

async function makeBackup(over: { schemaVersion?: number; appId?: string; balances?: { accountId: string; balanceMinor: number }[]; passphrase?: string } = {}): Promise<ByteSource> {
  const parts: Uint8Array[] = [];
  const r = await writeBackup(
    crypto,
    {
      passphrase: over.passphrase ?? 'a restore passphrase',
      schemaVersion: over.schemaVersion ?? 5,
      appId: over.appId ?? 'app.wmbugo',
      appVersion: '1.0',
      createdAt: { utcMs: 5, timezoneId: 'UTC' },
      counts: { entries: 1, accounts: 1, photos: 1 },
      accountBalances: over.balances ?? [{ accountId: 'acc-1', balanceMinor: 97_500 }],
      archiveKey: new Uint8Array(32).fill(3),
      entries: [entry(DB_NAME, utf8Encode(RESTORED_DB)), entry(`attachments/${PHOTO_ID}`, utf8Encode('new photo'))],
      kdf: { opslimit: 1, memlimit: 8192 },
    },
    { write: async (c) => void parts.push(new Uint8Array(c)) },
  );
  expect(r.ok).toBe(true);
  const bytes = concat(parts);
  return { size: bytes.length, read: async (o, n) => bytes.subarray(o, o + n) };
}

interface Rig {
  fs: MemFs;
  deps: RestoreDeps;
  events: string[];
  db: RestoreDb;
  checks: { value: StagedChecks };
}

function rig(over: { migrate?: 'ok' | 'too-new' | 'damaged'; currentBytes?: number } = {}): Rig {
  const fs = new MemFs();
  fs.files.set(L.dbPath, OLD_DB);
  fs.files.set(`${L.attachmentsDir}/old.enc`, OLD_PHOTO);
  const events: string[] = [];
  const checks = { value: { quickCheckOk: true, invariantsOk: true, balances: new Map([['acc-1', 97_500]]) } as StagedChecks };
  const db: RestoreDb = {
    async openEntry(name) {
      events.push(`entry:${name}`);
      const chunks: Uint8Array[] = [];
      return {
        write: async (c) => void chunks.push(new Uint8Array(c)),
        close: async () => {
          const text = utf8Decode(concat(chunks)) ?? '';
          if (name === DB_NAME) await fs.writeText(`${L.stagingDir}/raw.db`, text);
          else await fs.writeText(`${L.stagingAttachmentsDir}/${name.slice('attachments/'.length)}.enc`, text);
        },
      };
    },
    async migrateAndRekey(key) {
      events.push(`migrate:${key.length}`);
      if (over.migrate === 'too-new') return err('BACKUP_TOO_NEW');
      if (over.migrate === 'damaged') return err('BACKUP_DAMAGED');
      await fs.writeText(L.stagingDb, `${(await fs.readText(`${L.stagingDir}/raw.db`)) ?? ''}`);
      await fs.remove(`${L.stagingDir}/raw.db`);
      return ok(undefined);
    },
    async carryDeviceSettings() {
      events.push('carry');
    },
    async verify() {
      events.push('verify');
      return checks.value;
    },
    async currentDataBytes() {
      return over.currentBytes ?? 1000;
    },
  };
  const maintenance: Maintenance = { enter: () => void events.push('maintenance:on'), exit: () => void events.push('maintenance:off') };
  return { fs, events, db, checks, deps: { crypto, fs, layout: L, db, maintenance, appSchemaVersion: 5 } };
}

describe('restoreBackup (Story 8.8)', () => {
  it('stages, migrates, re-keys, verifies, swaps, and keeps the replaced data as the safety copy until the next start', async () => {
    const r = rig();
    const res = await restoreBackup(r.deps, await makeBackup(), 'a restore passphrase');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.safetyCopyKept).toBe(true);
    expect(r.events).toEqual(['maintenance:on', 'entry:db', `entry:attachments/${PHOTO_ID}`, 'migrate:64', 'carry', 'verify']); // maintenance stays on: the app restarts
    expect(r.fs.files.get(L.dbPath)).toBe(RESTORED_DB);
    expect(r.fs.files.get(`${L.attachmentsDir}/${PHOTO_ID}.enc`)).toBe('new photo');
    expect(r.fs.files.get(`${L.safetyDir}/db`)).toBe(OLD_DB);
    expect(r.fs.files.get(`${L.safetyDir}/attachments/old.enc`)).toBe(OLD_PHOTO);
    expect(JSON.parse(r.fs.files.get(L.journalPath)!)).toMatchObject({ phase: 'swapped', withSafety: true });
    expect(r.fs.files.has(L.stagingDb)).toBe(false);
  });

  it('the next successful start deletes the safety copy and the journal', async () => {
    const r = rig();
    await restoreBackup(r.deps, await makeBackup(), 'a restore passphrase');
    expect(await recoverRestore(r.fs, L, async () => true)).toBe('restored');
    expect([...r.fs.files.keys()].sort()).toEqual([L.dbPath, `${L.attachmentsDir}/${PHOTO_ID}.enc`].sort());
    expect(r.fs.files.get(L.dbPath)).toBe(RESTORED_DB);
  });

  it('a restored database that fails its start checks is replaced by the safety copy', async () => {
    const r = rig();
    await restoreBackup(r.deps, await makeBackup(), 'a restore passphrase');
    expect(await recoverRestore(r.fs, L, async () => false)).toBe('restore-failed');
    expect(r.fs.files.get(L.dbPath)).toBe(OLD_DB);
    expect(r.fs.files.get(`${L.attachmentsDir}/old.enc`)).toBe(OLD_PHOTO);
    expect([...r.fs.files.keys()].sort()).toEqual([L.dbPath, `${L.attachmentsDir}/old.enc`].sort());
    expect(RESTORE_REVERTED_MESSAGE).toBe("The restore didn't finish. Your phone is as it was before.");
    // a check that throws counts as a failure
    const r2 = rig();
    await restoreBackup(r2.deps, await makeBackup(), 'a restore passphrase');
    expect(await recoverRestore(r2.fs, L, async () => Promise.reject(new Error('open failed')))).toBe('restore-failed');
    expect(r2.fs.files.get(L.dbPath)).toBe(OLD_DB);
  });

  describe('refused before any change: the working data is byte-identical and the writer is never paused', () => {
    const cases: [string, () => Promise<ByteSource>, string, string][] = [
      ['a wrong passphrase', () => makeBackup(), 'not the passphrase', 'WRONG_PASSPHRASE'],
      ['a newer schema', () => makeBackup({ schemaVersion: 6 }), 'a restore passphrase', 'BACKUP_TOO_NEW'],
      ['a file that is not a backup', async () => ({ size: 5000, read: async (o: number, n: number) => new Uint8Array(n).fill(7).subarray(0, Math.max(0, Math.min(n, 5000 - o))) }), 'a restore passphrase', 'NOT_A_WMBUGO_BACKUP'],
      ['a damaged backup', async () => {
        const s = await makeBackup();
        const bytes = await s.read(0, s.size);
        const bad = new Uint8Array(bytes);
        bad[bad.length - 5] = bad[bad.length - 5]! ^ 1;
        return { size: bad.length, read: async (o: number, n: number) => bad.subarray(o, o + n) };
      }, 'a restore passphrase', 'BACKUP_DAMAGED'],
    ];
    for (const [name, make, pass, code] of cases) {
      it(name, async () => {
        const r = rig();
        const before = r.fs.snapshot();
        const res = await restoreBackup(r.deps, await make(), pass);
        expect(res).toEqual({ ok: false, code });
        expect(r.fs.snapshot()).toBe(before);
        expect(r.events).not.toContain('maintenance:on');
      });
    }
  });

  it('a restore on schema N+1 of a backup made at N is accepted (migration runs), and so is a backup from the SMS package', async () => {
    const r = rig();
    const res = await restoreBackup({ ...r.deps, appSchemaVersion: 6 }, await makeBackup({ schemaVersion: 5, appId: 'app.wmbugo.sms' }), 'a restore passphrase');
    expect(res.ok).toBe(true);
    expect(res.ok && res.value.manifest.appId).toBe('app.wmbugo.sms');
    const r2 = rig();
    expect((await restoreBackup(r2.deps, await makeBackup({ appId: 'app.wmbugo' }), 'a restore passphrase')).ok).toBe(true);
  });

  describe('failures while staging leave the working data untouched and the writer running again', () => {
    for (const [name, setup, code] of [
      ['a migration that cannot run', (r: Rig) => void ((r.db as { migrateAndRekey: unknown }).migrateAndRekey = async () => err('BACKUP_DAMAGED')), 'BACKUP_DAMAGED'],
      ['a staged database that is newer than the app', (r: Rig) => void ((r.db as { migrateAndRekey: unknown }).migrateAndRekey = async () => err('BACKUP_TOO_NEW')), 'BACKUP_TOO_NEW'],
      ['quick_check failing', (r: Rig) => void (r.checks.value = { quickCheckOk: false, invariantsOk: true, balances: new Map([['acc-1', 97_500]]) }), 'BACKUP_DAMAGED'],
      ['a writer invariant failing', (r: Rig) => void (r.checks.value = { quickCheckOk: true, invariantsOk: false, balances: new Map([['acc-1', 97_500]]) }), 'BACKUP_DAMAGED'],
      ['an account balance that differs from the manifest', (r: Rig) => void (r.checks.value = { quickCheckOk: true, invariantsOk: true, balances: new Map([['acc-1', 97_501]]) }), 'BACKUP_DAMAGED'],
      ['an account missing from the staged data', (r: Rig) => void (r.checks.value = { quickCheckOk: true, invariantsOk: true, balances: new Map() }), 'BACKUP_DAMAGED'],
    ] as const) {
      it(name, async () => {
        const r = rig();
        setup(r);
        const live = [L.dbPath, `${L.attachmentsDir}/old.enc`].map((p) => [p, r.fs.files.get(p)]);
        const res = await restoreBackup(r.deps, await makeBackup(), 'a restore passphrase');
        expect(res).toEqual({ ok: false, code });
        expect([L.dbPath, `${L.attachmentsDir}/old.enc`].map((p) => [p, r.fs.files.get(p)])).toEqual(live);
        expect([...r.fs.files.keys()].some((k) => k.startsWith('priv/'))).toBe(false); // staging deleted
        expect(r.events[0]).toBe('maintenance:on');
        expect(r.events[r.events.length - 1]).toBe('maintenance:off');
      });
    }
  });

  describe('free space', () => {
    it('refuses with LOW_SPACE_NEEDS_CONFIRMATION when there is less than twice the data size, and changes nothing', async () => {
      const r = rig({ currentBytes: 1000 });
      r.fs.free = 1999;
      const before = r.fs.snapshot();
      expect(await restoreBackup(r.deps, await makeBackup(), 'a restore passphrase')).toEqual({ ok: false, code: 'LOW_SPACE_NEEDS_CONFIRMATION' });
      expect(r.fs.snapshot()).toBe(before);
      expect(r.events).not.toContain('maintenance:on');
    });

    it('exactly twice the data size is enough', async () => {
      const r = rig({ currentBytes: 1000 });
      r.fs.free = 2000;
      expect((await restoreBackup(r.deps, await makeBackup(), 'a restore passphrase')).ok).toBe(true);
    });

    it('with withoutSafetyCopy it proceeds without one: the replaced data is gone and nothing waits for the next start', async () => {
      const r = rig({ currentBytes: 1000 });
      r.fs.free = 10;
      const res = await restoreBackup(r.deps, await makeBackup(), 'a restore passphrase', { withoutSafetyCopy: true });
      expect(res.ok && res.value.safetyCopyKept).toBe(false);
      expect(r.fs.files.get(L.dbPath)).toBe(RESTORED_DB);
      expect([...r.fs.files.keys()].some((k) => k.startsWith(L.safetyDir))).toBe(false);
      expect(await recoverRestore(r.fs, L, async () => true)).toBe('restored');
    });
  });
});

describe('the app is killed at every step (fault injection, NFR-12)', () => {
  /** Runs a restore that dies after `n` file operations, then starts the app again: recovery, then the start checks. */
  async function killedAt(n: number, withSafety: boolean) {
    const r = rig({ currentBytes: 1000 });
    const backup = await makeBackup();
    r.fs.killAfter(n);
    const res = await restoreBackup(r.deps, backup, 'a restore passphrase', { withoutSafetyCopy: !withSafety }).catch(() => ({ ok: false as const, code: 'RESTORE_FAILED' as const }));
    const died = r.fs.mutations >= n && !res.ok;
    r.fs.revive();
    const outcome = await recoverRestore(r.fs, L, async () => true);
    return { r, res, outcome, died };
  }

  const oldState = (r: Rig) => r.fs.files.get(L.dbPath) === OLD_DB && r.fs.files.get(`${L.attachmentsDir}/old.enc`) === OLD_PHOTO;
  const newState = (r: Rig) => r.fs.files.get(L.dbPath) === RESTORED_DB && r.fs.files.get(`${L.attachmentsDir}/${PHOTO_ID}.enc`) === 'new photo';

  it('with a safety copy: at every step the next start finds either the old data intact or the restored data, never a mixture', async () => {
    let seenOld = 0;
    let seenNew = 0;
    for (let n = 0; n < 40; n++) {
      const { r, res, outcome } = await killedAt(n, true);
      const label = `killed after ${n} operations (${outcome})`;
      if (res.ok) {
        // The restore finished before the kill point: the restored data opens, and the leftovers are cleaned up.
        expect({ label, new: newState(r) }).toEqual({ label, new: true });
        seenNew++;
        continue;
      }
      expect({ label, old: oldState(r), new: newState(r) }).toEqual({ label, old: oldState(r), new: newState(r) });
      expect({ label, ok: oldState(r) || newState(r) }).toEqual({ label, ok: true });
      expect({ label, mixed: oldState(r) && newState(r) }).toEqual({ label, mixed: false });
      // Nothing but the live data is left behind.
      expect({ label, extra: [...r.fs.files.keys()].filter((k) => k.startsWith('priv/')) }).toEqual({ label, extra: [] });
      if (oldState(r)) seenOld++;
      else seenNew++;
    }
    expect(seenOld).toBeGreaterThan(0);
    expect(seenNew).toBeGreaterThan(0);
  });

  it('before the swap, staging is discarded and the pre-restore data opens intact', async () => {
    const { r, outcome } = await killedAt(3, true);
    expect(['staging-discarded', 'none']).toContain(outcome);
    expect(oldState(r)).toBe(true);
  });

  it('killed during the swap with a safety copy: rolled back to the old data', async () => {
    const r = rig({ currentBytes: 1000 });
    const backup = await makeBackup();
    // Find how many operations a clean restore takes, then kill one before its end.
    const clean = rig({ currentBytes: 1000 });
    await restoreBackup(clean.deps, backup, 'a restore passphrase');
    const total = clean.fs.mutations;
    r.fs.killAfter(total - 2);
    await restoreBackup(r.deps, backup, 'a restore passphrase');
    r.fs.revive();
    expect(await recoverRestore(r.fs, L, async () => true)).toBe('rolled-back');
    expect(oldState(r)).toBe(true);
  });

  it('without a safety copy a swap cut short is completed from staging, and an earlier kill leaves the old data', async () => {
    let completed = 0;
    for (let n = 0; n < 40; n++) {
      const { r, res, outcome } = await killedAt(n, false);
      const label = `no safety copy, killed after ${n} (${outcome})`;
      if (res.ok) continue;
      expect({ label, ok: oldState(r) || newState(r) }).toEqual({ label, ok: true });
      if (outcome === 'rolled-forward') {
        expect(r.fs.files.get(L.dbPath)).toBe(RESTORED_DB);
        completed++;
      }
    }
    expect(completed).toBeGreaterThan(0);
  });

  it('a damaged journal is dropped and the live data is left alone', async () => {
    const r = rig();
    r.fs.files.set(L.journalPath, '{broken');
    r.fs.files.set(`${L.stagingDir}/x`, 'leftover');
    expect(await recoverRestore(r.fs, L, async () => true)).toBe('staging-discarded');
    expect(oldState(r)).toBe(true);
    expect(r.fs.files.has(L.journalPath)).toBe(false);
  });

  it('with nothing in progress, recovery does nothing', async () => {
    const r = rig();
    const before = r.fs.snapshot();
    expect(await recoverRestore(r.fs, L, async () => true)).toBe('none');
    expect(r.fs.snapshot()).toBe(before);
  });
});
