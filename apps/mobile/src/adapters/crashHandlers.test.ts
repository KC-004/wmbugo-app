import { createCrashRecorder, type FileStore } from '@wmbugo/core';
import { installCrashHandlers, resetCrashHandlersForTest } from './crashHandlers';

function memFiles(): FileStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    exists: async (p) => map.has(p),
    size: async (p) => (map.get(p) ?? '').length,
    append: async (p, t) => void map.set(p, (map.get(p) ?? '') + t),
    write: async (p, t) => void map.set(p, t),
    move: async (a, b) => {
      map.set(b, map.get(a) ?? '');
      map.delete(a);
    },
    remove: async (p) => void map.delete(p),
    read: async (p) => map.get(p) ?? '',
    list: async (d) => [...map.keys()].filter((k) => k.startsWith(`${d}/`)).map((k) => k.slice(d.length + 1)),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('crash handlers', () => {
  beforeEach(() => resetCrashHandlersForTest());

  it('records an uncaught JS error, redacted, and still calls the previous handler', async () => {
    const files = memFiles();
    const recorder = createCrashRecorder(files, { dir: 'crashes', context: () => ({ now: 5, appVersion: '1.0', schemaVersion: 3 }) });
    const previous = jest.fn();
    let handler: ((e: unknown, f?: boolean) => void) | undefined;
    const errorUtils = { getGlobalHandler: () => previous, setGlobalHandler: (h: (e: unknown, f?: boolean) => void) => void (handler = h) };
    expect(installCrashHandlers(recorder, { errorUtils })).toBe(true);
    const err = new Error('failed for sara@okhdfc 1234567');
    handler!(err, true);
    await flush();
    expect(previous).toHaveBeenCalledWith(err, true);
    const all = await recorder.readAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: 'js', message: 'failed for [id] [n]' });
    expect(JSON.stringify(all[0])).not.toMatch(/sara|1234567/);
  });

  it('records an unhandled promise rejection', async () => {
    const files = memFiles();
    const recorder = createCrashRecorder(files, { dir: 'crashes', context: () => ({ now: 5, appVersion: '1.0', schemaVersion: null }) });
    let onUnhandled: ((id: number, e: unknown) => void) | undefined;
    installCrashHandlers(recorder, { hermes: { enablePromiseRejectionTracker: (o) => void (onUnhandled = o.onUnhandled) } });
    onUnhandled!(1, new RangeError('x 9999'));
    await flush();
    expect((await recorder.readAll())[0]).toMatchObject({ kind: 'promise', errorType: 'RangeError', message: 'x [n]' });
  });

  it('does not stack handlers when installed twice', () => {
    const recorder = createCrashRecorder(memFiles(), { dir: 'c', context: () => ({ now: 1, appVersion: '1', schemaVersion: null }) });
    const set = jest.fn();
    const eu = { getGlobalHandler: () => jest.fn(), setGlobalHandler: set };
    installCrashHandlers(recorder, { errorUtils: eu });
    expect(installCrashHandlers(recorder, { errorUtils: eu })).toBe(false);
    expect(set).toHaveBeenCalledTimes(1);
  });
});

describe('crash handlers: a fatal error and a storm (Epic 8 review)', () => {
  beforeEach(() => resetCrashHandlersForTest());

  it('a fatal error is written before the previous handler is allowed to end the process', async () => {
    const order: string[] = [];
    let release!: () => void;
    const recorder = {
      record: () => new Promise<void>((res) => (release = () => (order.push('written'), res()))),
      readAll: async () => [],
    };
    const previous = jest.fn(() => void order.push('previous'));
    let handler!: (e: unknown, f?: boolean) => void;
    installCrashHandlers(recorder, { errorUtils: { getGlobalHandler: () => previous, setGlobalHandler: (h) => void (handler = h) } });
    handler(new Error('fatal'), true);
    await flush();
    expect(previous).not.toHaveBeenCalled(); // still waiting for the disk
    release();
    await flush();
    expect(order).toEqual(['written', 'previous']);
  });

  it('a record that never finishes does not keep a dying app alive: the previous handler runs after the flush window', async () => {
    jest.useFakeTimers();
    try {
      const recorder = { record: () => new Promise<void>(() => undefined), readAll: async () => [] };
      const previous = jest.fn();
      let handler!: (e: unknown, f?: boolean) => void;
      installCrashHandlers(recorder, { errorUtils: { getGlobalHandler: () => previous, setGlobalHandler: (h) => void (handler = h) } });
      handler(new Error('fatal'), true);
      await jest.advanceTimersByTimeAsync(1600);
      expect(previous).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('the same non-fatal error again within a minute is not recorded again, a different one is, and the previous handler always runs', async () => {
    let t = 1000;
    const record = jest.fn(async () => undefined);
    const recorder = { record, readAll: async () => [] };
    const previous = jest.fn();
    let handler!: (e: unknown, f?: boolean) => void;
    installCrashHandlers(recorder, { now: () => t, errorUtils: { getGlobalHandler: () => previous, setGlobalHandler: (h) => void (handler = h) } });
    const a = new Error('loop');
    for (let i = 0; i < 5; i++) handler(a, false);
    expect(record).toHaveBeenCalledTimes(1);
    expect(previous).toHaveBeenCalledTimes(5);
    handler(new TypeError('other'), false);
    expect(record).toHaveBeenCalledTimes(2);
    t += 61_000;
    handler(a, false);
    expect(record).toHaveBeenCalledTimes(3);
  });
});
