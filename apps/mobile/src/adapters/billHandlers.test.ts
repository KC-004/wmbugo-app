import type { EventEnvelope, HandlerMap, Logger } from '@wmbugo/core';
import { serialize, withBillHandlers, withReminderSync } from './billHandlers';

const event = (name: EventEnvelope['name']): EventEnvelope => ({ id: 'e1', name, actor: 'user', payload: {}, createdAt: 1 }) as unknown as EventEnvelope;
const logger = (): Logger & { warn: jest.Mock } => ({ log: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() });
const run = async (map: HandlerMap, name: EventEnvelope['name']) => {
  for (const h of map[name] ?? []) await h(event(name));
};

describe('the bill handlers composed onto the invalidation handlers (Epic 6 review)', () => {
  it('releases bill links and goal moves on TransactionsChanged, after the invalidation handler', async () => {
    const order: string[] = [];
    const base: HandlerMap = { TransactionsChanged: [() => void order.push('invalidate')] };
    const map = withBillHandlers(base, async () => void order.push('release'), logger());
    await run(map, 'TransactionsChanged');
    expect(order).toEqual(['invalidate', 'release']);
  });

  it('a throwing release is logged by name and does not throw', async () => {
    const log = logger();
    const map = withBillHandlers({}, () => Promise.reject(new Error('boom')), log);
    await expect(run(map, 'TransactionsChanged')).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith('bills.release_threw');
  });

  it('syncs reminders on a bill change, an entry change and a profile change, after the release', async () => {
    const order: string[] = [];
    const withRelease = withBillHandlers({}, async () => void order.push('release'), logger());
    const map = withReminderSync(withRelease, async () => void order.push('sync'), logger());
    await run(map, 'TransactionsChanged');
    await run(map, 'RecurringChanged');
    await run(map, 'ProfileChanged');
    expect(order).toEqual(['release', 'sync', 'sync', 'sync']);
  });

  it('a failing sync is logged and does not throw', async () => {
    const log = logger();
    const map = withReminderSync({}, () => Promise.reject(new Error('boom')), log);
    await expect(run(map, 'RecurringChanged')).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith('bills.reminder_sync_threw');
  });
});

describe('serialize', () => {
  it('runs overlapping calls one after the other, in order, so an older sync never lands last', async () => {
    const order: string[] = [];
    let n = 0;
    const slow = serialize(async () => {
      const mine = ++n;
      order.push(`start ${mine}`);
      await new Promise((r) => setTimeout(r, mine === 1 ? 20 : 0));
      order.push(`end ${mine}`);
    });
    await Promise.all([slow(), slow()]);
    expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
  });

  it('keeps going after a call fails', async () => {
    let n = 0;
    const flaky = serialize(async () => {
      if (++n === 1) throw new Error('first');
      return 'ok';
    });
    await expect(flaky()).rejects.toThrow('first');
    await expect(flaky()).resolves.toBe('ok');
  });
});
