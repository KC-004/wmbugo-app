import { classifyStartupFailure, integrityCheckDue, quickCheckPasses, SAFE_MODE_BANNER, SAFE_MODE_KEY_LOST, SAFE_MODE_MIGRATION, SAFE_MODE_NO_BACKUP } from './safeMode';
import type { StartupErrorCode } from './startup';

describe('safe mode (Story 8.12)', () => {
  const facts = (databaseExists: boolean, keyMissing: boolean) => ({ databaseExists, keyMissing });

  it('a database that cannot be opened is unreadable', () => {
    for (const code of ['DATABASE_OPEN_FAILED', 'STORAGE_UNSAFE', 'DATABASE_NEWER_THAN_APP', 'MIGRATION_CHECKSUM_MISMATCH', 'MIGRATION_BUNDLE_INVALID'] as StartupErrorCode[]) {
      expect(classifyStartupFailure(code, facts(true, false))).toBe('unreadable');
    }
  });

  it('a migration that rolled back is its own message, with Try again', () => {
    expect(classifyStartupFailure('MIGRATION_FAILED', facts(true, false))).toBe('migration');
  });

  it('a missing key is lost only when the database file exists and the Keystore plainly holds none', () => {
    expect(classifyStartupFailure('KEY_UNAVAILABLE', facts(true, true))).toBe('key-lost');
    expect(classifyStartupFailure('KEY_UNAVAILABLE', facts(false, true))).toBe('unreadable'); // no database: nothing to lose
    expect(classifyStartupFailure('KEY_UNAVAILABLE', facts(true, false))).toBe('unreadable'); // the Keystore could not be asked or held a bad key
  });

  it('the wording is exact', () => {
    expect(SAFE_MODE_BANNER).toBe("wmbugo can't safely change your data right now. Your entries are untouched.");
    expect(SAFE_MODE_MIGRATION).toBe("wmbugo couldn't finish updating your data. Nothing was lost.");
    expect(SAFE_MODE_KEY_LOST).toBe("This phone's key for wmbugo is gone, so the data here can't be opened. A backup is the only way to get it back.");
    expect(SAFE_MODE_NO_BACKUP).toBe("The data can't be read, so it can't be backed up.");
  });

  it('quick_check passes only when it answers a single ok row; a failure or a throw is safe mode', async () => {
    expect(await quickCheckPasses({ query: async () => [['ok']] })).toBe(true);
    expect(await quickCheckPasses({ query: async () => [['*** in database main ***\nPage 5: btree page is out of order']] })).toBe(false);
    expect(await quickCheckPasses({ query: async () => [['ok'], ['row 3 missing from index x']] })).toBe(false);
    expect(await quickCheckPasses({ query: async () => [] })).toBe(false);
    expect(await quickCheckPasses({ query: async () => Promise.reject(new Error('file is not a database')) })).toBe(false);
  });

  it('the integrity check is due once per local day', () => {
    expect(integrityCheckDue(null, '2026-11-21')).toBe(true);
    expect(integrityCheckDue('2026-11-21', '2026-11-21')).toBe(false);
    expect(integrityCheckDue('2026-11-20', '2026-11-21')).toBe(true);
  });
});
