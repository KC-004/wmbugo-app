import type { FileStore } from '../ports/filestore';
import { buildCrashRecord, createCrashRecorder, MAX_CRASH_RECORDS } from './crashRecord';
import { createFileLogSink } from './fileLogSink';
import { createRedactingLogger, REDACTED, redactEntry, scrubFrame, scrubText } from './logger';
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

describe('redaction hardening from the Epic 8 code review', () => {
  it('a string under an id key must be a UUID: a name or a number under merchantId is redacted', () => {
    const e = redactEntry('info', 'x', {
      merchantId: 'Swiggy',
      accountId: '0192a3b4-aaaa-7bbb-8ccc-000000000001',
      id: 'Rent to Sara',
      ids: ['0192a3b4-aaaa-7bbb-8ccc-000000000001', 'Swiggy'],
    });
    expect(e.fields.merchantId).toBe(REDACTED);
    expect(e.fields.accountId).toBe('0192a3b4-aaaa-7bbb-8ccc-000000000001');
    expect(e.fields.id).toBe(REDACTED);
    expect(e.fields.ids).toEqual(['0192a3b4-aaaa-7bbb-8ccc-000000000001', REDACTED]);
  });

  it('a code key holds a code, not a sentence: a reason with words in it is redacted, a code survives', () => {
    const e = redactEntry('warn', 'x', { reason: 'Rent to Sara', code: 'SAFE_MODE', kind: 'js', route: 'home', step: 'db-installed' });
    expect(e.fields.reason).toBe(REDACTED);
    expect(e.fields.code).toBe('SAFE_MODE');
    expect(e.fields.kind).toBe('js');
    expect(e.fields.route).toBe('home');
    expect(e.fields.step).toBe('db-installed');
  });

  it('counts and durations are numbers, and versions are dotted digits: text under them is redacted', () => {
    const e = redactEntry('info', 'x', { itemCount: 'Swiggy 450', durationMs: 120, appVersion: '1.10.2', schemaVersion: 7, version: 'Swiggy' });
    expect(e.fields.itemCount).toBe(REDACTED);
    expect(e.fields.durationMs).toBe(120);
    expect(e.fields.appVersion).toBe('1.10.2');
    expect(e.fields.schemaVersion).toBe(7);
    expect(e.fields.version).toBe(REDACTED);
  });

  it('small amounts are scrubbed too: a single digit after a symbol, and a plain two-decimal figure', () => {
    expect(scrubText('paid ₹5 for tea')).toBe('paid [n] for tea');
    expect(scrubText('paid $7 for tea')).toBe('paid [n] for tea');
    expect(scrubText('balance 45.50 left')).toBe('balance [n] left');
    expect(scrubText('Rs. 9')).toBe('[n]');
    expect(scrubText('version 1.0 ok')).toBe('version 1.0 ok'); // a short dotted number is not an amount
  });

  it('a stack frame keeps its location (so it can be symbolicated) and scrubs the function name', () => {
    expect(scrubFrame('at pay₹450 (index.android.bundle:1:2345)')).toBe('at pay[n] (index.android.bundle:1:2345)');
    expect(scrubFrame('doThing@address at index.android.bundle:1:2345')).toBe('doThing@address at index.android.bundle:1:2345');
  });

  it('a message line that looks like a frame is never stored as one: the stack header lines are dropped first', () => {
    const err = new Error('first line\nat rent 9876543210@okbank\nsara@upi sent 4500');
    err.stack = 'Error: first line\nat rent 9876543210@okbank\nsara@upi sent 4500\n    at realFrame (index.android.bundle:1:23)';
    const rec = buildCrashRecord({ now: 1, appVersion: '1.0', schemaVersion: 3 }, 'js', err);
    expect(rec.frames).toEqual(['at realFrame (index.android.bundle:1:23)']);
    expect(rec.message).not.toMatch(/9876543210|sara@upi|4500/);
  });

  it('records sort in write order even within one millisecond (counter 10 after 9), and the directory is prepared before the first write', async () => {
    const files = new MemFiles();
    const order: string[] = [];
    const rec = createCrashRecorder(files, {
      dir: 'crashes',
      context: () => ({ now: 5, appVersion: '1.0', schemaVersion: 1 }),
      prepare: async () => void order.push('prepare'),
      maxRecords: 100,
    });
    for (let i = 0; i < 12; i++) await rec.record('js', new Error(`e${i}`));
    expect(order).toEqual(['prepare']); // once
    const all = await rec.readAll();
    expect(all.map((r) => r.message)).toEqual(Array.from({ length: 12 }, (_, i) => `e${11 - i}`)); // newest first, 10 and 11 after 9
  });
});

describe('a record written by the native recorder is read by the same reader (Epic 8 review)', () => {
  it('reads the exact shape NativeCrashRecorder.kt writes: padded name, empty message, null schema, escaped control characters in frames', async () => {
    const files = new MemFiles();
    // Byte for byte what Kotlin builds: a quote, a backslash and a tab inside a frame are escaped, the message is empty.
    const kotlinJson =
      '{"t":1700000000000,"appVersion":"1.0","schemaVersion":null,"kind":"native","errorType":"java.lang.IllegalStateException","message":"",' +
      '"frames":["at app.wmbugo.Foo.bar (Foo.kt:12)","at weird\\u0009name\\\\ \\"quoted\\" (?:-1)"]}';
    files.files.set('crashes/crash-001700000000000-0000.json', kotlinJson);
    files.files.set('crashes/crash-001700000000000-0001.json', '{"t":1700000000000,"appVersion":"1.0","kind":"native","frames":["a\tb"]}'); // a raw tab is invalid JSON: skipped
    const rec = createCrashRecorder(files, { dir: 'crashes', context: () => ({ now: 1, appVersion: '1.0', schemaVersion: null }) });
    const all = await rec.readAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: 'native', message: '', schemaVersion: null, errorType: 'java.lang.IllegalStateException' });
    expect(all[0]!.frames[1]).toBe('at weird\tname\\ "quoted" (?:-1)');
  });
});
