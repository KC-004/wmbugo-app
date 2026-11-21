import { eraseAllData, finishInterruptedErase, ERASE_SCOPE_LINES, type EraseDeps, type EraseLayout } from './erase';
import { retentionLine } from './policy';

const L: EraseLayout = {
  dbPath: 'db/wmbugo.db',
  attachmentsDir: 'files/receipts',
  stagingDir: 'files/staging',
  safetyDir: 'files/safety-restore',
  journalPath: 'files/restore.journal',
  logsDir: 'files/logs',
  crashesDir: 'files/crashes',
  otherPaths: ['files/restore-notice.txt', 'files/safety/wmbugo.db.before-v3', 'cache/viewing'],
  markerPath: 'files/erase.marker',
};

/** Memory file system that freezes after n mutations, like a killed process. */
class Fs {
  files = new Map<string, string>(
    Object.entries({
      'db/wmbugo.db': 'DB',
      'db/wmbugo.db-wal': 'WAL',
      'db/wmbugo.db-shm': 'SHM',
      'files/receipts/a.enc': 'photo',
      'files/staging/x': 'staging',
      'files/safety-restore/db': 'safety',
      'files/restore.journal': '{}',
      'files/logs/wmbugo.log': 'log',
      'files/logs/wmbugo.log.1': 'log1',
      'files/crashes/crash-1.json': 'crash',
      'files/restore-notice.txt': '3 Nov',
      'files/safety/wmbugo.db.before-v3': 'old',
      'cache/viewing/a.img': 'plain',
      // Files the person saved elsewhere are not wmbugo's to delete.
      'shared/Documents/wmbugo-backup-2026-11-08.wmbugo': 'BACKUP',
      'shared/Documents/wmbugo-diagnostics.txt': 'DIAG',
      // Another app's files.
      'other-app/data': 'theirs',
    }),
  );
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
  private guard() {
    if (this.dead) throw new Error('process killed');
  }
  private mutate() {
    this.guard();
    if (this.limit !== null && this.mutations >= this.limit) {
      this.dead = true;
      throw new Error('process killed');
    }
    this.mutations++;
  }
  async exists(p: string) {
    this.guard();
    return [...this.files.keys()].some((k) => k === p || k.startsWith(`${p}/`));
  }
  async remove(p: string) {
    this.mutate();
    for (const k of [...this.files.keys()]) if (k === p || k.startsWith(`${p}/`)) this.files.delete(k);
  }
  async writeText(p: string, t: string) {
    this.mutate();
    this.files.set(p, t);
  }
}

function setup(over: Partial<EraseDeps> = {}) {
  const fs = new Fs();
  const events: string[] = [];
  let keyPresent = true;
  const deps: EraseDeps = {
    fs,
    layout: L,
    maintenance: { enter: () => void events.push('maintenance:on'), exit: () => void events.push('maintenance:off') },
    cancelNotifications: async () => void events.push('cancel-notifications'),
    closeDatabase: async () => void events.push('close-db'),
    deleteKey: async () => {
      events.push('delete-key');
      keyPresent = false;
    },
    ...over,
  };
  return { fs, deps, events, key: () => keyPresent };
}

const PERSON_OWNED = ['shared/Documents/wmbugo-backup-2026-11-08.wmbugo', 'shared/Documents/wmbugo-diagnostics.txt', 'other-app/data'];

describe('EraseAllData (Story 8.11)', () => {
  it('enters maintenance, marks, cancels notifications, closes the database, deletes every file, deletes the key, removes the marker', async () => {
    const s = setup();
    const r = await eraseAllData(s.deps);
    expect(r.ok).toBe(true);
    expect(s.events).toEqual(['maintenance:on', 'cancel-notifications', 'close-db', 'delete-key']);
    // No wmbugo data and no marker are left, and nothing that is not wmbugo's was touched.
    expect([...s.fs.files.keys()].sort()).toEqual([...PERSON_OWNED].sort());
    expect(s.key()).toBe(false);
  });

  it('writes the marker first (a kill right after it leaves the marker and every file)', async () => {
    const s = setup();
    s.fs.killAfter(1); // the marker write succeeds, then the process dies
    const r = await eraseAllData(s.deps);
    expect(r).toEqual({ ok: false, code: 'ERASE_FAILED' });
    s.fs.revive();
    expect(s.fs.files.get(L.markerPath)).toBe('erase');
    expect(s.fs.files.get(L.dbPath)).toBe('DB');
  });

  it('a failing key deletion keeps the marker so the next start finishes the job', async () => {
    const s = setup({ deleteKey: async () => Promise.reject(new Error('keystore busy')) });
    expect(await eraseAllData(s.deps)).toEqual({ ok: false, code: 'ERASE_FAILED' });
    expect(s.fs.files.has(L.markerPath)).toBe(true);
  });

  it('killed at every step, the next start finds the marker, finishes the erase before anything else, and nothing is left', async () => {
    for (let n = 0; n < 30; n++) {
      const s = setup();
      s.fs.killAfter(n);
      const first = await eraseAllData(s.deps);
      s.fs.revive();
      if (first.ok) {
        expect({ n, left: [...s.fs.files.keys()].sort() }).toEqual({ n, left: [...PERSON_OWNED].sort() });
        continue;
      }
      expect({ n, marker: s.fs.files.has(L.markerPath) || n === 0 }).toEqual({ n, marker: true });
      const finished = await finishInterruptedErase(s.deps);
      if (n === 0) {
        expect(finished).toBe('none'); // killed before the marker was written: nothing was started, the data is intact
        expect(s.fs.files.get(L.dbPath)).toBe('DB');
        continue;
      }
      expect({ n, finished }).toEqual({ n, finished: 'finished' });
      expect({ n, left: [...s.fs.files.keys()].sort() }).toEqual({ n, left: [...PERSON_OWNED].sort() });
      expect({ n, key: s.key() }).toEqual({ n, key: false });
      expect(await finishInterruptedErase(s.deps)).toBe('none'); // and the start after that finds nothing to do
    }
  });

  it('a start whose recovery cannot finish says so, keeps the marker, and the next start finishes it', async () => {
    const s = setup({ deleteKey: async () => Promise.reject(new Error('keystore busy')) });
    s.fs.files.set(L.markerPath, 'erase');
    expect(await finishInterruptedErase(s.deps)).toBe('failed');
    expect(s.fs.files.has(L.markerPath)).toBe(true);
    const again = setup();
    again.fs.files.set(L.markerPath, 'erase');
    expect(await finishInterruptedErase(again.deps)).toBe('finished');
  });

  it('with no marker, a start does nothing and touches nothing', async () => {
    const s = setup();
    const before = [...s.fs.files.entries()].sort().toString();
    expect(await finishInterruptedErase(s.deps)).toBe('none');
    expect([...s.fs.files.entries()].sort().toString()).toBe(before);
    expect(s.events).toEqual([]);
  });

  it('says what it erases and what it does not', () => {
    expect(ERASE_SCOPE_LINES[0]).toBe('This erases from this phone: all entries, accounts, budgets, bills, goals, categories, photos, settings and the app log.');
    expect(ERASE_SCOPE_LINES[1]).toBe("Backup files you saved elsewhere aren't touched. Delete them yourself if you want them gone.");
    expect(ERASE_SCOPE_LINES[2]).toBe("This can't be undone.");
  });
});

describe('retention line (Story 8.11)', () => {
  it('states the Story 3.12 rules from the same constants the purge uses', () => {
    expect(retentionLine()).toBe("Deleted entries stay in Recently deleted for 30 days. Rejected payments stay 90 days. Then they're removed for good.");
  });
});
