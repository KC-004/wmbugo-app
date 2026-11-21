import type { LedgerWriter, Logger, SqlDatabase } from '@wmbugo/core';
import { useSafeModeStore } from '../shared/state/safeModeStore';

jest.mock('./backup/rnRestore', () => ({ RESTORE_LAYOUT: { dbPath: 'db/wmbugo.db' } }));
jest.mock('./files/rnFileStore', () => ({ rnFileStore: { exists: jest.fn(async () => true) } }));
jest.mock('./storage/keychainKeyStore', () => ({ keychainKeyStore: { getKey: jest.fn(async () => null) } }));

import { rnFileStore } from './files/rnFileStore';
import { keychainKeyStore } from './storage/keychainKeyStore';
import { describeStartupFailure, enterSafeMode, localToday, recheckWith, scheduleIntegrityChecks } from './safeMode';

afterEach(() => useSafeModeStore.setState({ reason: null }));

const log = (): Logger & { entries: string[] } => {
  const entries: string[] = [];
  const f = (level: string) => (event: string) => void entries.push(`${level}:${event}`);
  return { entries, log: () => undefined, debug: f('debug'), info: f('info'), warn: f('warn'), error: f('error') } as never;
};
const writer = () => {
  let reason: string | null = null;
  return {
    setSafeMode: (r: string | null) => void (reason = r),
    get inSafeMode() {
      return reason !== null;
    },
    get reason() {
      return reason;
    },
  } as unknown as LedgerWriter & { reason: string | null };
};
const dbReturning = (rows: string[][]): SqlDatabase => ({ query: jest.fn(async () => rows) }) as unknown as SqlDatabase;
const flush = () => new Promise((r) => setTimeout(r, 40));

describe('describeStartupFailure (Story 8.12)', () => {
  it('calls a missing key lost only when the database file exists and the Keystore plainly has none', async () => {
    expect(await describeStartupFailure('KEY_UNAVAILABLE')).toBe('key-lost');
    (rnFileStore.exists as jest.Mock).mockResolvedValueOnce(false);
    expect(await describeStartupFailure('KEY_UNAVAILABLE')).toBe('unreadable');
    (keychainKeyStore.getKey as jest.Mock).mockRejectedValueOnce(new Error('keystore down'));
    expect(await describeStartupFailure('KEY_UNAVAILABLE')).toBe('unreadable');
    (keychainKeyStore.getKey as jest.Mock).mockResolvedValueOnce('a'.repeat(64));
    expect(await describeStartupFailure('DATABASE_OPEN_FAILED')).toBe('unreadable');
    expect(await describeStartupFailure('MIGRATION_FAILED')).toBe('migration');
  });
});

describe('entering safe mode and the integrity checks (Story 8.12)', () => {
  it('stops the writer, shows the banner reason, and logs a code only', () => {
    const w = writer();
    const l = log();
    enterSafeMode(w, l, 'quick_check_failed');
    expect(w.reason).toBe('quick_check_failed');
    expect(useSafeModeStore.getState().reason).toBe('quick_check_failed');
    expect(l.entries).toEqual(['error:safe_mode']);
  });

  it('runs quick_check after start, once per local day, and enters safe mode when it fails', async () => {
    const w = writer();
    let day = '2026-11-21';
    let resume!: () => void;
    const db = dbReturning([['*** in database main ***']]);
    scheduleIntegrityChecks(db, w, log(), () => day, (task) => {
      resume = task;
      task();
      return () => undefined;
    });
    await flush();
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(w.reason).toBe('quick_check_failed');
    expect(useSafeModeStore.getState().reason).toBe('quick_check_failed');
    // Already in safe mode: no more checks.
    day = '2026-11-22';
    resume();
    await flush();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('a healthy database stays out of safe mode, and the check repeats only when the day changes', async () => {
    const w = writer();
    let day = '2026-11-21';
    let resume!: () => void;
    const db = dbReturning([['ok']]);
    scheduleIntegrityChecks(db, w, log(), () => day, (task) => {
      resume = task;
      task();
      return () => undefined;
    });
    await flush();
    resume();
    await flush();
    expect(db.query).toHaveBeenCalledTimes(1); // same day
    day = '2026-11-22';
    resume();
    await flush();
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(w.inSafeMode).toBe(false);
    expect(useSafeModeStore.getState().reason).toBeNull();
  });

  it('a database that cannot answer twice in a row enters safe mode as integrity_check_threw', async () => {
    const w = writer();
    const db = { query: jest.fn(async () => Promise.reject(new Error('file is not a database'))) } as unknown as SqlDatabase;
    scheduleIntegrityChecks(
      db,
      w,
      log(),
      () => '2026-11-21',
      (task) => {
        task();
        return () => undefined;
      },
      1,
    );
    await flush();
    expect(db.query).toHaveBeenCalledTimes(2); // it asked again before giving up
    expect(w.reason).toBe('integrity_check_threw');
  });

  it('a busy database that answers on the second ask does not enter safe mode', async () => {
    const w = writer();
    const query = jest.fn().mockRejectedValueOnce(new Error('database is locked')).mockResolvedValue([['ok']]);
    scheduleIntegrityChecks(
      { query } as unknown as SqlDatabase,
      w,
      log(),
      () => '2026-11-21',
      (task) => {
        task();
        return () => undefined;
      },
      1,
    );
    await flush();
    expect(query).toHaveBeenCalledTimes(2);
    expect(w.inSafeMode).toBe(false);
  });

  it('a day is checked once the check has answered; two resumes while it runs ask only once', async () => {
    const w = writer();
    let resume!: () => void;
    const query = jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return [['ok']];
    });
    scheduleIntegrityChecks({ query } as unknown as SqlDatabase, w, log(), () => '2026-11-21', (task) => {
      resume = task;
      task();
      return () => undefined;
    });
    resume();
    await new Promise((r) => setTimeout(r, 40));
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('Check again leaves safe mode when the database now answers ok, and stays in it when it does not', async () => {
    const w = writer();
    w.setSafeMode('quick_check_failed');
    useSafeModeStore.setState({ reason: 'quick_check_failed' });
    expect(await recheckWith(dbReturning([['ok']]), w, log())).toBe(true);
    expect(w.inSafeMode).toBe(false);
    expect(useSafeModeStore.getState().reason).toBeNull();
    w.setSafeMode('quick_check_failed');
    useSafeModeStore.setState({ reason: 'quick_check_failed' });
    expect(await recheckWith(dbReturning([['*** in database main ***']]), w, log())).toBe(false);
    expect(w.inSafeMode).toBe(true);
    expect(useSafeModeStore.getState().reason).toBe('quick_check_failed');
  });

  it('localToday reads the date in the profile timezone', () => {
    expect(localToday(Date.UTC(2026, 10, 21, 20, 0, 0), 'Asia/Singapore')).toBe('2026-11-22');
    expect(localToday(Date.UTC(2026, 10, 21, 20, 0, 0), 'Not/AZone')).toBeNull();
  });
});
