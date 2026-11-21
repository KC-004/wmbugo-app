import type { FileStore } from '../ports/filestore';
import { buildCrashRecord, createCrashRecorder, MAX_CRASH_RECORDS } from './crashRecord';
import { createFileLogSink } from './fileLogSink';
import { createRedactingLogger, REDACTED, redactEntry, scrubText } from './logger';
import { logFixtureEntry, REDACTION_FIXTURE_VALUES } from '../testing/redactionFixture';

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

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('allowlist redaction (Story 8.1)', () => {
  it('keeps ids, counts, codes, durations and versions only', () => {
    const e = redactEntry('info', 'x', {
      id: '0192a3b4-aaaa-7bbb-8ccc-0123456789ab',
      accountId: '0192a3b4-aaaa-7bbb-8ccc-0123456789ac',
      entryCount: 4,
      code: 'X',
      durationMs: 9,
      schemaVersion: 25,
      appVersion: '1.0.0',
      ok: true,
      surprise: 'a brand new field name',
      flag: true,
    });
    expect(e.fields).toEqual({
      id: '0192a3b4-aaaa-7bbb-8ccc-0123456789ab',
      accountId: '0192a3b4-aaaa-7bbb-8ccc-0123456789ac',
      entryCount: 4,
      code: 'X',
      durationMs: 9,
      schemaVersion: 25,
      appVersion: '1.0.0',
      ok: true,
      surprise: REDACTED,
      flag: REDACTED,
    });
  });

  it('redacts a field whose name is not on the allowlist even when the value looks harmless', () => {
    expect(redactEntry('info', 'x', { label: 'ok' }).fields.label).toBe(REDACTED);
    expect(redactEntry('info', 'x', { nested: { a: 1 } }).fields.nested).toBe(REDACTED);
  });

  it('scrubs digit runs, emails, UPI ids and masked accounts in free text', () => {
    expect(scrubText('paid 1234 to a@b')).toBe('paid [n] to [id]');
    expect(scrubText('sara@okhdfc')).toBe('[id]');
    expect(scrubText('card ••4821')).toBe('card [acct]');
    expect(scrubText('XX4821 and A/c *4821 and a/c no. 4821')).toBe('[acct] and [acct] and [acct]');
    expect(scrubText('₹1,18,600')).toBe('[n]');
    expect(scrubText('code 42')).toBe('code 42');
  });

  it('keeps no fixture value in the log file in any form', async () => {
    const files = new MemFiles();
    const logger = createRedactingLogger(createFileLogSink(files, { path: 'log', maxBytes: 100_000, now: () => 1 }));
    logFixtureEntry(logger);
    await flush();
    const text = files.files.get('log')!;
    for (const v of REDACTION_FIXTURE_VALUES) expect(text).not.toContain(v);
    expect(text).not.toMatch(/Swiggy|Instamart|rent for|sara|okhdfc|HDFC|4821|118600|1,18|receipts\/a\.jpg|debited|998877/);
    expect(text).toContain('"durationMs":42');
    expect(text).toContain('"entryCount":3');
  });
});

describe('crash records (Story 8.1)', () => {
  const ctx = { now: 1_700_000_000_000, appVersion: '1.0.0', schemaVersion: 25 };

  it('builds a record with a scrubbed message and code locations only', () => {
    const err = new TypeError('cannot read ₹1,18,600 of sara@okhdfc at ••4821');
    err.stack = `TypeError: cannot read ₹1,18,600\n    at saveEntry (http://localhost:8081/index.bundle:1234:56)\n    at Object.run (app:///index.android.bundle:9:10)`;
    const rec = buildCrashRecord(ctx, 'js', err);
    expect(rec).toMatchObject({ t: ctx.now, appVersion: '1.0.0', schemaVersion: 25, kind: 'js', errorType: 'TypeError' });
    expect(JSON.stringify(rec)).not.toMatch(/118600|1,18|sara|okhdfc|4821/);
    expect(rec.frames).toEqual(['at saveEntry (http://localhost:8081/index.bundle:1234:56)', 'at Object.run (app:///index.android.bundle:9:10)']);
  });

  it('handles non-Error values', () => {
    expect(buildCrashRecord(ctx, 'promise', 'boom 12345').message).toBe('boom [n]');
    expect(buildCrashRecord(ctx, 'promise', { a: 1 }).errorType).toBe('object');
  });

  it('keeps the newest 20 records and drops the oldest', async () => {
    const files = new MemFiles();
    let t = 1000;
    const rec = createCrashRecorder(files, { dir: 'crashes', context: () => ({ ...ctx, now: t++ }) });
    for (let i = 0; i < MAX_CRASH_RECORDS + 5; i++) await rec.record('js', new Error(`boom ${i}`));
    const names = await files.list('crashes');
    expect(names).toHaveLength(MAX_CRASH_RECORDS);
    const all = await rec.readAll();
    expect(all).toHaveLength(MAX_CRASH_RECORDS);
    expect(all[0]!.t).toBe(1000 + MAX_CRASH_RECORDS + 4);
    expect(all[all.length - 1]!.t).toBe(1005);
  });

  it('never throws when the disk fails and logs only the type', async () => {
    const files = new MemFiles();
    files.write = () => Promise.reject(new Error('disk full'));
    const lines: string[] = [];
    const logger = createRedactingLogger({ write: (e) => lines.push(JSON.stringify(e)) });
    const rec = createCrashRecorder(files, { dir: 'crashes', context: () => ctx, logger });
    await expect(rec.record('js', new Error('x'))).resolves.toBeUndefined();
    expect(lines).toEqual([]);
  });
});
