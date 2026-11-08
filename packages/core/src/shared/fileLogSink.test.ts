import type { FileStore } from '../ports/filestore';
import { createFileLogSink } from './fileLogSink';
import { createRedactingLogger } from './logger';

class MemFiles implements FileStore {
  files = new Map<string, string>();
  failAppend = false;
  exists = (p: string) => Promise.resolve(this.files.has(p));
  size = (p: string) => Promise.resolve((this.files.get(p) ?? '').length);
  append = (p: string, t: string) => {
    if (this.failAppend) return Promise.reject(new Error('disk full'));
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
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('size-capped file log sink', () => {
  it('writes JSON lines in order', async () => {
    const files = new MemFiles();
    const logger = createRedactingLogger(createFileLogSink(files, { path: 'log', maxBytes: 10_000, now: () => 7 }));
    logger.info('a');
    logger.warn('b', { code: 'X' });
    await flush();
    const lines = files.files.get('log')!.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.event)).toEqual(['a', 'b']);
    expect(lines[0].t).toBe(7);
  });

  it('rotates to one older generation and stays under 2 x the cap', async () => {
    const files = new MemFiles();
    const logger = createRedactingLogger(createFileLogSink(files, { path: 'log', maxBytes: 300, now: () => 1 }));
    for (let i = 0; i < 200; i++) logger.info(`event.number.${i}`);
    await flush();
    await flush();
    expect(files.files.has('log.1')).toBe(true);
    expect(files.files.get('log')!.length).toBeLessThanOrEqual(300);
    expect(files.files.get('log.1')!.length).toBeLessThanOrEqual(300);
    expect([...files.files.keys()].sort()).toEqual(['log', 'log.1']);
  });

  it('is redacted before it reaches the file', async () => {
    const files = new MemFiles();
    const logger = createRedactingLogger(createFileLogSink(files, { path: 'log', maxBytes: 10_000, now: () => 1 }));
    logger.info('saved', { amountMinor: 123456, note: 'rent', detail: 'paid Rs. 500 from XX1234' });
    await flush();
    const text = files.files.get('log')!;
    expect(text).not.toMatch(/123456|rent|500|1234/);
  });

  it('never throws when the disk fails', async () => {
    const files = new MemFiles();
    files.failAppend = true;
    const logger = createRedactingLogger(createFileLogSink(files, { path: 'log', maxBytes: 100, now: () => 1 }));
    expect(() => logger.error('x')).not.toThrow();
    await flush();
    files.failAppend = false;
    logger.error('y');
    await flush();
    expect(files.files.get('log')).toContain('"y"');
  });
});
