import { AddAccount, openingBalanceShape } from '../ledger/accountCommands';
import { entryShape } from '../ledger/entryCommands';
import { findRegion } from '../profile/regions';
import { parseSettings, SETTINGS_SQL } from '../profile/settings';
import { ChangeSetting, RecordBackupMade } from '../profile/settingsCommands';
import type { Crypto } from '../ports/crypto';
import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { recordEntry } from '../testing/capture';
import { createSodiumCrypto } from '../testing/sodiumCrypto';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { LedgerWriter } from '../writer/ledgerWriter';
import { DB_NAME, MANIFEST_NAME, concat, toHex } from './format';
import { backupCountsLine, backupSummary, checkPassphrase, passphraseHint, suggestedBackupName } from './policy';
import { extractBackup, readManifest } from './reader';
import { runBackup, type BackupDocument, type BackupPlatform, type RunBackupDeps } from './runBackup';
import type { BackupEntrySource } from './writer';

let crypto: Crypto;
beforeAll(async () => {
  crypto = await createSodiumCrypto();
});

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);
const KDF = { opslimit: 1, memlimit: 8192 };
const PASS = 'a passphrase of enough length';

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Singapore');
  const writer = new LedgerWriter({
    uow: db,
    clock,
    newId: createIdGenerator(clock, seededRandom(5)),
    logger: createRedactingLogger({ write: () => undefined }),
    invariants: [openingBalanceShape, entryShape],
  });
  await writer.run(SetUpProfile, { region: findRegion('SG')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Singapore' }, 'user');
  await writer.run(AddAccount, { name: 'DBS', type: 'bank', openingMinor: 100_000 }, 'user');
  await writer.run(AddAccount, { name: 'Cash', type: 'cash', openingMinor: null }, 'user');
  const accountId = (await db.query("SELECT id FROM account WHERE name = 'DBS'"))[0]![0] as string;
  await recordEntry(writer, { kind: 'expense', amountMinor: 2_500, categoryId: 'cat_food', accountId });
  return { db, clock, writer, accountId };
}

const dbBytes = new Uint8Array(150_000).map((_, i) => (i * 31) & 255);
const photo = new Uint8Array(3000).map((_, i) => (i * 7) & 255);

function entry(name: string, data: Uint8Array): BackupEntrySource {
  return {
    name,
    size: data.length,
    sha256: crypto.sha256(data),
    async *read() {
      yield data;
    },
  };
}

interface Rig {
  platform: BackupPlatform;
  written: Uint8Array[];
  events: string[];
  doc: BackupDocument;
}

function rig(over: { cancelDialog?: boolean; failWriteAt?: number } = {}): Rig {
  const written: Uint8Array[] = [];
  const events: string[] = [];
  let n = 0;
  const doc: BackupDocument = {
    sink: {
      async write(c) {
        if (over.failWriteAt !== undefined && ++n >= over.failWriteAt) throw new Error('disk full');
        written.push(new Uint8Array(c));
      },
    },
    async commit() {
      events.push('commit');
    },
    async abort() {
      events.push('abort');
    },
  };
  const platform: BackupPlatform = {
    async createDocument(name) {
      events.push(`dialog:${name}`);
      return over.cancelDialog ? null : doc;
    },
    async exportDatabase(keyHex) {
      events.push(`export:${keyHex.length}`);
      return { entry: entry(DB_NAME, dbBytes), cleanup: async () => void events.push('cleanup') };
    },
    async photos() {
      events.push('photos');
      return [entry('attachments/0192a3b4-aaaa-7bbb-8ccc-000000000001', photo)];
    },
  };
  return { platform, written, events, doc };
}

function deps(s: Awaited<ReturnType<typeof setup>>, r: Rig, over: Partial<RunBackupDeps> = {}): RunBackupDeps {
  return {
    crypto,
    db: s.db,
    platform: r.platform,
    hold: (fn) => s.writer.exclusive(fn),
    appId: 'app.wmbugo',
    appVersion: '1.0',
    nowMs: () => NOW,
    timezoneId: () => 'Asia/Singapore',
    recordBackupMade: async (atMs) => void (await s.writer.run(RecordBackupMade, { atMs }, 'user')),
    kdf: KDF,
    ...over,
  };
}

describe('runBackup (Story 8.7)', () => {
  it('asks for a place with the suggested name, backs up, records last_backup_at, and the file opens with the passphrase', async () => {
    const s = await setup();
    const r = rig();
    const progress: number[] = [];
    const res = await runBackup(deps(s, r, { onProgress: (f) => progress.push(f) }), PASS);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(r.events[0]).toBe('dialog:wmbugo-backup-2026-11-08.wmbugo');
    expect(r.events).toEqual(expect.arrayContaining(['photos', 'commit', 'cleanup']));
    expect(r.events).not.toContain('abort');
    expect(res.value.counts).toEqual({ entries: 1, accounts: 2, photos: 1 });
    expect(backupCountsLine(res.value.counts)).toBe('1 entry · 2 accounts · 1 photo');
    // The progress is determinate and ends at 1.
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
    // last_backup_at is set.
    expect(parseSettings(await s.db.query(SETTINGS_SQL)).lastBackupAt).toBe(NOW);
    // The file opens: manifest facts match the database, and the entries come back byte for byte.
    const file = concat(r.written);
    const src = { size: file.length, read: async (o: number, n: number) => file.subarray(o, o + n) };
    const m = await readManifest(crypto, src, PASS, { appSchemaVersion: 999 });
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.value.counts).toEqual({ entries: 1, accounts: 2, photos: 1 });
    // Cash has no balance set, so only DBS is compared; DBS = opening 1,000.00 minus the 25.00 entry.
    expect(m.value.accountBalances).toEqual([{ accountId: s.accountId, balanceMinor: 97_500 }]);
    expect(m.value.schemaVersion).toBeGreaterThanOrEqual(0); // the test database applies the SQL without the schema_migration ledger
    expect(m.value.archiveKey).toHaveLength(64);
    const got = new Map<string, Uint8Array[]>();
    const x = await extractBackup(crypto, src, PASS, { appSchemaVersion: 999 }, async (name) => {
      got.set(name, []);
      return { write: async (c) => void got.get(name)!.push(new Uint8Array(c)) };
    });
    expect(x.ok).toBe(true);
    expect(toHex(concat(got.get(DB_NAME)!))).toBe(toHex(dbBytes));
    expect(MANIFEST_NAME).toBe('manifest.json');
  });

  it('cancelling the system dialog writes nothing and changes nothing', async () => {
    const s = await setup();
    const r = rig({ cancelDialog: true });
    expect(await runBackup(deps(s, r), PASS)).toEqual({ ok: false, code: 'DOCUMENT_CANCELLED' });
    expect(r.written).toEqual([]);
    expect(r.events).toEqual([expect.stringMatching(/^dialog:/)]);
    expect(parseSettings(await s.db.query(SETTINGS_SQL)).lastBackupAt).toBeNull();
  });

  it('a failing destination (full disk, provider error) deletes the partial document, cleans staging, records nothing', async () => {
    const s = await setup();
    const r = rig({ failWriteAt: 2 });
    expect(await runBackup(deps(s, r), PASS)).toEqual({ ok: false, code: 'BACKUP_FAILED' });
    expect(r.events).toEqual(expect.arrayContaining(['abort', 'cleanup']));
    expect(r.events).not.toContain('commit');
    expect(parseSettings(await s.db.query(SETTINGS_SQL)).lastBackupAt).toBeNull();
  });

  it('Cancel stops the backup mid-way, deletes the partial document and reports CANCELLED', async () => {
    const s = await setup();
    const r = rig();
    let calls = 0;
    const res = await runBackup(deps(s, r, { isCancelled: () => ++calls > 3 }), PASS);
    expect(res).toEqual({ ok: false, code: 'CANCELLED' });
    expect(r.events).toEqual(expect.arrayContaining(['abort', 'cleanup']));
    expect(parseSettings(await s.db.query(SETTINGS_SQL)).lastBackupAt).toBeNull();
  });

  it('an empty or weak passphrase is refused before the save dialog opens, so no document is ever created', async () => {
    const s = await setup();
    for (const weak of ['', 'short', 'aaaaaaaaaaaa', 'abababababab']) {
      const r = rig();
      expect(await runBackup(deps(s, r), weak)).toEqual({ ok: false, code: 'PASSPHRASE_TOO_WEAK' });
      expect(r.events).toEqual([]); // not even the dialog
    }
  });

  it('progress and Cancel start as soon as a place is chosen, before the export, and a cancel during the export deletes the document', async () => {
    const s = await setup();
    const r = rig();
    const seen: string[] = [];
    let cancelled = false;
    const base = r.platform.exportDatabase.bind(r.platform);
    r.platform.exportDatabase = async (k) => {
      seen.push('export');
      cancelled = true; // Cancel pressed while the database is being exported
      return base(k);
    };
    const res = await runBackup(deps(s, r, { onProgress: () => void seen.push('progress'), isCancelled: () => cancelled }), PASS);
    expect(res).toEqual({ ok: false, code: 'CANCELLED' });
    expect(seen.slice(0, 2)).toEqual(['progress', 'export']);
    expect(r.events).toContain('abort');
    expect(r.events).not.toContain('commit');
  });

  it('a saved backup is reported as saved even when last_backup_at cannot be recorded', async () => {
    const s = await setup();
    const r = rig();
    const res = await runBackup(
      deps(s, r, {
        recordBackupMade: async () => {
          throw new Error('writer is busy');
        },
      }),
      PASS,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.recorded).toBe(false);
    expect(r.events).toContain('commit');
    expect(r.events).not.toContain('abort'); // the file is kept
  });

  it('a save dialog that fails after creating the document fails the backup cleanly', async () => {
    const s = await setup();
    const r = rig();
    r.platform.createDocument = async () => {
      throw new Error('provider cannot open the file for writing');
    };
    expect(await runBackup(deps(s, r), PASS)).toEqual({ ok: false, code: 'BACKUP_FAILED' });
  });

  it('photos the platform left out are counted in the result', async () => {
    const s = await setup();
    const r = rig();
    r.platform.photosSkipped = () => 2;
    const res = await runBackup(deps(s, r), PASS);
    expect(res.ok && res.value.photosSkipped).toBe(2);
  });

  it('a failure while exporting the database aborts the document and leaves the data alone', async () => {
    const s = await setup();
    const r = rig();
    r.platform.exportDatabase = async () => {
      throw new Error('export failed');
    };
    expect(await runBackup(deps(s, r), PASS)).toEqual({ ok: false, code: 'BACKUP_FAILED' });
    expect(r.events).toContain('abort');
    const entries = await s.db.query('SELECT COUNT(*) FROM "transaction"');
    expect(Number(entries[0]![0])).toBeGreaterThan(0);
  });
});

describe('the writer is held for a consistent snapshot, and held work runs afterwards (Story 8.7)', () => {
  it('a use case submitted while the export runs waits, is not rejected, and is not in the exported facts', async () => {
    const s = await setup();
    const r = rig();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const basePhotos = r.platform.photos.bind(r.platform);
    r.platform.photos = async () => {
      order.push('export-running');
      await gate; // the backup is mid-export
      order.push('export-done');
      return basePhotos();
    };
    const backup = runBackup(deps(s, r), PASS);
    // Wait until the export is running, then submit a write.
    while (!order.includes('export-running')) await new Promise((res) => setTimeout(res, 1));
    const late = recordEntry(s.writer, { kind: 'expense', amountMinor: 999, categoryId: 'cat_food', accountId: s.accountId }).then((x) => {
      order.push('late-write-ran');
      return x;
    });
    await new Promise((res) => setTimeout(res, 20));
    expect(order).toEqual(['export-running']); // the late write is waiting
    release();
    const res = await backup;
    const lateResult = await late;
    expect(lateResult.ok).toBe(true); // nothing was rejected
    expect(order.indexOf('export-done')).toBeLessThan(order.indexOf('late-write-ran'));
    expect(res.ok && res.value.counts.entries).toBe(1); // the snapshot did not include the late write
    const total = await s.db.query(`SELECT COUNT(*) FROM "transaction" WHERE status = 'confirmed'`);
    expect(Number(total[0]![0])).toBeGreaterThanOrEqual(2);
  });

  it('exclusive runs after everything submitted before it, in order, and a failing fn does not break the queue', async () => {
    const s = await setup();
    const order: string[] = [];
    const first = s.writer.run(ChangeSetting, { key: 'theme', value: 'dark' }, 'user').then(() => order.push('first'));
    const ex = s.writer.exclusive(async () => void order.push('exclusive'));
    const second = s.writer.run(ChangeSetting, { key: 'theme', value: 'light' }, 'user').then(() => order.push('second'));
    await Promise.all([first, ex, second]);
    expect(order).toEqual(['first', 'exclusive', 'second']);
    await expect(s.writer.exclusive(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect((await s.writer.run(ChangeSetting, { key: 'theme', value: 'dark' }, 'user')).ok).toBe(true);
  });
});

describe('RecordBackupMade and the Data summary', () => {
  it('stores the time with an audit row naming the key only, refuses a bad time and the generic path', async () => {
    const s = await setup();
    expect((await s.writer.run(RecordBackupMade, { atMs: NOW }, 'user')).ok).toBe(true);
    expect(parseSettings(await s.db.query(SETTINGS_SQL)).lastBackupAt).toBe(NOW);
    const audit = await s.db.query("SELECT change_json FROM audit_event WHERE kind = 'RecordBackupMade'");
    expect(JSON.parse(String(audit[0]![0]))).toEqual({ changed: true });
    for (const atMs of [-1, 1.5, Number.NaN]) expect(await s.writer.run(RecordBackupMade, { atMs }, 'user')).toEqual({ ok: false, code: 'SETTING_INVALID' });
    expect(await s.writer.run(ChangeSetting, { key: 'backup.last_backup_at', value: 5 }, 'user')).toEqual({ ok: false, code: 'SETTING_INVALID' });
  });

  it('summarises as Last backup 3 Nov or No backup yet', () => {
    expect(backupSummary(null, 'Asia/Singapore')).toBe('No backup yet');
    expect(backupSummary(Date.UTC(2026, 10, 3, 12, 0, 0), 'Asia/Singapore')).toBe('Last backup 3 Nov');
    expect(backupSummary(Date.UTC(2026, 10, 3, 20, 0, 0), 'Asia/Singapore')).toBe('Last backup 4 Nov'); // already the 4th in Singapore
  });
});

describe('passphrase rules and file name', () => {
  it('Use at least 12 characters until 12 or more, then Strong enough (characters, not bytes)', () => {
    expect(passphraseHint('')).toBe('too-short');
    expect(passphraseHint('elevenchars')).toBe('too-short');
    expect(passphraseHint('twelve chars')).toBe('strong-enough');
    expect(passphraseHint('aaaaaaaaaaaa')).toBe('low-variety'); // twelve of one character is not a passphrase
    expect(passphraseHint('abababababab')).toBe('low-variety');
    expect(passphraseHint('abcdeabcdeab')).toBe('strong-enough');
    expect(passphraseHint('あいうえおかきくけこさし')).toBe('strong-enough'); // 12 characters, 36 bytes
    expect(passphraseHint('あいうえおかきくけこさ')).toBe('too-short'); // 11 characters
  });

  it('Save stays disabled until both are satisfied; a mismatch shows while the confirmation differs', () => {
    expect(checkPassphrase('long enough pass', '')).toEqual({ hint: 'strong-enough', mismatch: false, canSave: false });
    expect(checkPassphrase('long enough pass', 'long enough pas')).toEqual({ hint: 'strong-enough', mismatch: true, canSave: false });
    expect(checkPassphrase('long enough pass', 'long enough pass')).toEqual({ hint: 'strong-enough', mismatch: false, canSave: true });
    expect(checkPassphrase('short', 'short')).toEqual({ hint: 'too-short', mismatch: false, canSave: false });
  });

  it('suggests wmbugo-backup-YYYY-MM-DD.wmbugo in the profile timezone', () => {
    expect(suggestedBackupName(Date.UTC(2026, 10, 8, 10, 0, 0), 'Asia/Singapore')).toBe('wmbugo-backup-2026-11-08.wmbugo');
    expect(suggestedBackupName(Date.UTC(2026, 10, 8, 20, 0, 0), 'Asia/Singapore')).toBe('wmbugo-backup-2026-11-09.wmbugo');
  });
});

describe('restore preview helpers (Story 8.9)', () => {
  it('madeAtLabel reads 3 Nov 2026, 9:14 pm in the profile timezone', async () => {
    const { madeAtLabel } = await import('./policy');
    expect(madeAtLabel(Date.UTC(2026, 10, 3, 13, 14, 0), 'Asia/Singapore')).toBe('3 Nov 2026, 9:14 pm');
    expect(madeAtLabel(Date.UTC(2026, 10, 3, 1, 5, 0), 'Asia/Singapore')).toBe('3 Nov 2026, 9:05 am');
    expect(madeAtLabel(Date.UTC(2026, 10, 3, 4, 0, 0), 'Asia/Singapore')).toBe('3 Nov 2026, 12:00 pm');
  });

  it('inspectBackupHeader says at once whether a file is a wmbugo backup, without a passphrase', async () => {
    const { inspectBackupHeader } = await import('./reader');
    const s = await setup();
    const r = rig();
    await runBackup(deps(s, r), PASS);
    const file = concat(r.written);
    const src = (b: Uint8Array) => ({ size: b.length, read: async (o: number, n: number) => b.subarray(o, o + n) });
    expect(await inspectBackupHeader(src(file))).toEqual({ ok: true, value: { size: file.length } });
    expect(await inspectBackupHeader(src(new Uint8Array(2000).fill(1)))).toEqual({ ok: false, code: 'NOT_A_WMBUGO_BACKUP' });
    expect(await inspectBackupHeader(src(new Uint8Array(10)))).toEqual({ ok: false, code: 'NOT_A_WMBUGO_BACKUP' });
    expect(await inspectBackupHeader({ size: 5 * 1024 ** 3, read: async () => new Uint8Array(0) })).toEqual({ ok: false, code: 'FILE_TOO_LARGE' });
  });
});
