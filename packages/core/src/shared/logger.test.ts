import { createRedactingLogger, REDACTED, redactEntry, type LogEntry } from './logger';

function capture() {
  const entries: LogEntry[] = [];
  return { entries, logger: createRedactingLogger({ write: (e) => entries.push(e) }) };
}

describe('redacting Logger', () => {
  it('redacts sensitive fields by name before the sink sees them', () => {
    const { entries, logger } = capture();
    logger.info('save', { amountMinor: 123456, note: 'rent for Mei', accountMask: 'XX1234', merchant: 'Cafe', durationMs: 42 });
    expect(entries[0]!.fields).toEqual({
      amountMinor: REDACTED,
      note: REDACTED,
      accountMask: REDACTED,
      merchant: REDACTED,
      durationMs: 42,
    });
  });

  it('redacts amounts and masks hiding in free text of harmless fields', () => {
    const e = redactEntry('warn', 'failed', {
      detail: 'could not save ₹1,234.50 from XX1234 and Rs. 99 plus 4567890',
      status: 'ok',
    });
    const d = String(e.fields.detail);
    expect(d).not.toMatch(/1,234/);
    expect(d).not.toMatch(/1234/);
    expect(d).not.toMatch(/4567890/);
    expect(d).not.toMatch(/99/);
    expect(e.fields.status).toBe('ok');
  });

  it('redacts nested objects and arrays', () => {
    const e = redactEntry('info', 'x', { ctx: { balance: 5, items: [{ note: 'a' }, 'USD 12.00'], flag: true } });
    expect(JSON.stringify(e)).not.toMatch(/USD 12/);
    expect(JSON.stringify(e)).not.toMatch(/"balance":5/);
    expect(JSON.stringify(e)).not.toMatch(/"note":"a"/);
    expect((e.fields.ctx as { flag: boolean }).flag).toBe(true);
  });

  it('redacts amounts in the event name too', () => {
    expect(redactEntry('info', 'paid $12.50', {}).event).not.toMatch(/12\.50/);
  });

  it('keeps null/undefined for sensitive keys without leaking', () => {
    const e = redactEntry('info', 'x', { note: null, memo: undefined });
    expect(e.fields).toEqual({ note: null, memo: undefined });
  });

  it('provides every level and writes exactly one entry per call', () => {
    const { entries, logger } = capture();
    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');
    expect(entries.map((e) => e.level)).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('bounds recursion depth', () => {
    let deep: Record<string, unknown> = { amountMinor: 1 };
    for (let i = 0; i < 20; i++) deep = { inner: deep };
    const e = redactEntry('info', 'x', deep as never);
    expect(JSON.stringify(e)).not.toMatch(/"amountMinor":1/);
  });
});
