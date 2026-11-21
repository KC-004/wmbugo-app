import type { FileStore } from '../ports/filestore';
import { buildCrashRecord } from './crashRecord';
import { buildDiagnosticsText, crashLine, diagnosticsFileName, LOG_LINES_IN_REPORT, NOT_AVAILABLE, redactLogLine, sizeLabel, statusLines, type DiagnosticsStatus } from './diagnostics';
import { createFileLogSink } from './fileLogSink';
import { createRedactingLogger } from './logger';
import { logFixtureEntry, REDACTION_FIXTURE_VALUES } from '../testing/redactionFixture';

const STATUS: DiagnosticsStatus = {
  app: '1.0.0 (nosms)',
  schemaVersion: 26,
  storage: { dbBytes: 12.4 * 1024 * 1024, photoBytes: 38.1 * 1024 * 1024, logBytes: 0.6 * 1024 * 1024, freeBytes: 9.2 * 1024 ** 3 },
  notifications: 'allowed',
  biometrics: 'available',
  appLock: false,
  lastBackup: '3 Nov',
  crashes: { count: 1, lastDate: '7 Nov' },
  safeMode: 'Off',
};

class MemFiles implements FileStore {
  files = new Map<string, string>();
  exists = (p: string) => Promise.resolve(this.files.has(p));
  size = (p: string) => Promise.resolve((this.files.get(p) ?? '').length);
  append = (p: string, t: string) => {
    this.files.set(p, (this.files.get(p) ?? '') + t);
    return Promise.resolve();
  };
  write = (p: string, t: string) => {
    this.files.set(p, t);
    return Promise.resolve();
  };
  move = (a: string, b: string) => {
    this.files.set(b, this.files.get(a) ?? '');
    this.files.delete(a);
    return Promise.resolve();
  };
  remove = (p: string) => {
    this.files.delete(p);
    return Promise.resolve();
  };
  read = (p: string) => Promise.resolve(this.files.get(p) ?? '');
  list = (d: string) => Promise.resolve([...this.files.keys()].filter((k) => k.startsWith(`${d}/`)).map((k) => k.slice(d.length + 1)));
}

describe('status list (Story 8.10)', () => {
  it('reads like the screen: version and flavor, schema, storage, permissions, app lock, last backup, crashes, safe mode', () => {
    expect(statusLines(STATUS)).toEqual([
      'App: 1.0.0 (nosms)',
      'Database schema: 26',
      'Storage: Entries and settings 12.4 MB · Photos 38.1 MB · Log 0.6 MB · Free 9.2 GB',
      'Permissions: Notifications: allowed · Biometrics: available',
      'App lock: Off',
      'Last backup: 3 Nov',
      'Crash records: 1 recorded, 7 Nov',
      'Safe mode: Off',
    ]);
  });

  it('shows Not available for anything it cannot read, so it works without the database open', () => {
    const unreadable: DiagnosticsStatus = {
      app: null,
      schemaVersion: null,
      storage: { dbBytes: null, photoBytes: null, logBytes: null, freeBytes: null },
      notifications: null,
      biometrics: null,
      appLock: null,
      lastBackup: null,
      crashes: null,
      safeMode: null,
    };
    const text = statusLines(unreadable).join('\n');
    expect(text).toContain(`App: ${NOT_AVAILABLE}`);
    expect(text).toContain(`Database schema: ${NOT_AVAILABLE}`);
    expect(text).toContain(`Storage: Entries and settings ${NOT_AVAILABLE} · Photos ${NOT_AVAILABLE} · Log ${NOT_AVAILABLE} · Free ${NOT_AVAILABLE}`);
    expect(text).toContain(`App lock: ${NOT_AVAILABLE}`);
    expect(text).toContain(`Crash records: ${NOT_AVAILABLE}`);
    expect(text).toContain(`Safe mode: ${NOT_AVAILABLE}`);
  });

  it('none recorded and never backed up are plain words', () => {
    const t = statusLines({ ...STATUS, crashes: { count: 0, lastDate: null }, lastBackup: 'none' }).join('\n');
    expect(t).toContain('Crash records: None');
    expect(t).toContain('Last backup: None yet');
  });

  it('sizes read in MB and GB with one decimal', () => {
    expect(sizeLabel(0)).toBe('0.0 MB');
    expect(sizeLabel(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(sizeLabel(3 * 1024 ** 3)).toBe('3.0 GB');
    expect(sizeLabel(null)).toBe(NOT_AVAILABLE);
    expect(sizeLabel(-1)).toBe(NOT_AVAILABLE);
  });
});

describe('the exported text (Story 8.10, SEC-007)', () => {
  it('holds the status list, the last 500 log lines and the crash records, in that order', () => {
    const lines = Array.from({ length: 700 }, (_, i) => JSON.stringify({ t: i, level: 'info', event: `event.${i % 7}`, fields: { durationMs: i } }));
    const text = buildDiagnosticsText({ status: STATUS, logLines: lines, crashes: [buildCrashRecord({ now: 5, appVersion: '1.0', schemaVersion: 26 }, 'js', new Error('boom'))] });
    const sections = ['wmbugo diagnostics', '== Status ==', '== Log (last 500 lines, redacted) ==', '== Crash records (redacted) =='].map((h) => text.indexOf(h));
    expect(sections.every((i) => i >= 0)).toBe(true);
    expect([...sections].sort((a, b) => a - b)).toEqual(sections);
    const logPart = text.slice(sections[2]!, sections[3]!).trim().split('\n').slice(1);
    expect(logPart).toHaveLength(LOG_LINES_IN_REPORT);
    expect(logPart[0]).toContain('"t":200'); // 700 lines, the last 500 start at index 200
    expect(logPart[logPart.length - 1]).toContain('"t":699');
  });

  it('an empty log and no crashes read (empty) and (none)', () => {
    const text = buildDiagnosticsText({ status: STATUS, logLines: [], crashes: [] });
    expect(text).toContain('(empty)');
    expect(text).toContain('(none)');
  });

  it('is deterministic, so the saved bytes can equal the previewed text', () => {
    const input = { status: STATUS, logLines: ['{"t":1,"level":"info","event":"a","fields":{}}'], crashes: [] };
    expect(buildDiagnosticsText(input)).toBe(buildDiagnosticsText(input));
  });

  it('names the file wmbugo-diagnostics-2026-11-08.txt', () => {
    expect(diagnosticsFileName('2026-11-08')).toBe('wmbugo-diagnostics-2026-11-08.txt');
  });
});

describe('the Story 8.1 redaction test runs against the Diagnostics export', () => {
  it('no amount, merchant, note, account identifier, UPI id, image path or SMS text appears in the exported file', async () => {
    const files = new MemFiles();
    const logger = createRedactingLogger(createFileLogSink(files, { path: 'log', maxBytes: 100_000, now: () => 1 }));
    logFixtureEntry(logger);
    await new Promise((r) => setTimeout(r, 0));
    const logLines = files.files.get('log')!.trim().split('\n');
    const crash = buildCrashRecord({ now: 9, appVersion: '1.0', schemaVersion: 26 }, 'js', new Error('failed ₹1,18,600 for sara@okhdfc from ••4821'));
    const text = buildDiagnosticsText({ status: STATUS, logLines, crashes: [crash] });
    for (const v of REDACTION_FIXTURE_VALUES) expect(text).not.toContain(v);
    expect(text).not.toMatch(/Swiggy|Instamart|rent for|sara|okhdfc|HDFC|4821|118600|1,18|receipts\/a\.jpg|debited|998877/);
  });

  it('a log line written by an older build with forbidden fields is redacted again at export', () => {
    const old = JSON.stringify({ t: 5, level: 'info', event: 'saved', fields: { amountMinor: 11860000, merchant: 'Swiggy Instamart', note: 'rent for Feb', durationMs: 42, errorMessage: 'paid 1234567 to a@b' } });
    const out = redactLogLine(old);
    expect(out).not.toMatch(/11860000|Swiggy|rent for|1234567|a@b/);
    expect(out).toContain('"durationMs":42');
    expect(out).toContain('"t":5');
  });

  it('a line that is not the expected JSON is scrubbed as text', () => {
    const out = redactLogLine('crash at ₹1,18,600 by sara@okhdfc ref 998877');
    expect(out).not.toMatch(/1,18|sara|okhdfc|998877/);
    expect(redactLogLine('{"event":5}')).not.toMatch(/\d{3}/);
  });

  it('a crash record is scrubbed again', () => {
    const line = crashLine({ t: 1, appVersion: '1.0', schemaVersion: 3, kind: 'js', errorType: 'Error 123456', message: 'sara@okhdfc paid 99999', frames: ['at f (x:1:2)'] });
    expect(line).not.toMatch(/123456|sara|99999/);
    expect(line).toContain('at f (x:1:2)');
  });
});
