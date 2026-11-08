import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { ok } from '../shared/result';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import type { EventEnvelope } from './events';
import { MemoryDatabase } from './fakes';
import { LedgerWriter, type UseCase } from './ledgerWriter';
import { OutboxDispatcher, type HandlerMap } from './outbox';

function setup(handlers: HandlerMap = {}) {
  const db = new MemoryDatabase();
  const clock = new FakeClock(1_000);
  const logger = createRedactingLogger({ write: () => undefined });
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(3)), logger });
  const dispatcher = () => new OutboxDispatcher({ db, clock, logger, handlers });
  return { db, clock, writer, dispatcher };
}

const raise = (id: string): UseCase<void, void, never> => ({
  name: 'Raise',
  async execute(ctx) {
    ctx.emit('TransactionsChanged', { transactionIds: [id] });
    return ok(undefined);
  },
});

describe('OutboxDispatcher', () => {
  it('delivers committed events in order and marks them delivered', async () => {
    const seen: string[] = [];
    const { db, clock, writer, dispatcher } = setup({
      TransactionsChanged: [(e: EventEnvelope) => void seen.push((e.payload as { transactionIds: string[] }).transactionIds[0]!)],
    });
    for (const id of ['a', 'b', 'c']) {
      clock.advance(1);
      await writer.run(raise(id), undefined, 'user');
    }
    expect(await dispatcher().deliverPending()).toEqual({ delivered: 3, failed: 0 });
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(db.outbox.every((o) => o.delivered_at !== null)).toBe(true);
    expect(await dispatcher().deliverPending()).toEqual({ delivered: 0, failed: 0 });
    expect(seen).toHaveLength(3);
  });

  it('passes the event id, name, actor, payload and time to handlers', async () => {
    let got: EventEnvelope | undefined;
    const { db, writer, dispatcher } = setup({ TransactionsChanged: [(e) => void (got = e)] });
    await writer.run(raise('x'), undefined, 'auto');
    await dispatcher().deliverPending();
    expect(got).toEqual({ id: db.outbox[0]!.id, name: 'TransactionsChanged', actor: 'auto', payload: { transactionIds: ['x'] }, createdAt: 1_000 });
  });

  it('events with no handler are still marked delivered', async () => {
    const { db, writer, dispatcher } = setup({});
    await writer.run(raise('x'), undefined, 'user');
    expect(await dispatcher().deliverPending()).toEqual({ delivered: 1, failed: 0 });
    expect(db.outbox[0]!.delivered_at).not.toBeNull();
  });

  it('a throwing handler leaves the event pending, stops there, and it is delivered again later (at least once)', async () => {
    let fail = true;
    const calls: string[] = [];
    const { db, clock, writer, dispatcher } = setup({
      TransactionsChanged: [
        (e) => {
          calls.push(e.id);
          if (fail) throw new Error('handler down');
        },
      ],
    });
    for (const id of ['a', 'b']) {
      clock.advance(1);
      await writer.run(raise(id), undefined, 'user');
    }
    expect(await dispatcher().deliverPending()).toEqual({ delivered: 0, failed: 2 });
    expect(db.outbox.every((o) => o.delivered_at === null)).toBe(true);
    expect(calls).toHaveLength(1); // stopped at the first failure to keep order
    fail = false;
    expect(await dispatcher().deliverPending()).toEqual({ delivered: 2, failed: 0 });
    expect(calls).toHaveLength(3);
  });

  it('killed after commit but before delivery: a fresh dispatcher on next start delivers the events', async () => {
    const seen: string[] = [];
    const { db, writer } = setup();
    await writer.run(raise('a'), undefined, 'user');
    // "app restart": nothing was delivered; a new dispatcher is built over the same database.
    const logger = createRedactingLogger({ write: () => undefined });
    const next = new OutboxDispatcher({
      db,
      clock: new FakeClock(5),
      logger,
      handlers: { TransactionsChanged: [(e) => void seen.push(e.id)] },
    });
    expect(await next.deliverPending()).toEqual({ delivered: 1, failed: 0 });
    expect(seen).toEqual([db.outbox[0]!.id]);
  });

  it('crash between the handler and the delivered mark redelivers; an idempotent handler applies it once', async () => {
    const applied = new Set<string>();
    let deliveries = 0;
    const { db, writer, dispatcher } = setup({
      TransactionsChanged: [
        (e) => {
          deliveries += 1;
          applied.add(e.id); // idempotent on event id
        },
      ],
    });
    await writer.run(raise('a'), undefined, 'user');
    db.failNextDeliveredMark = true;
    expect(await dispatcher().deliverPending()).toEqual({ delivered: 0, failed: 1 });
    expect(await dispatcher().deliverPending()).toEqual({ delivered: 1, failed: 0 });
    expect(deliveries).toBe(2);
    expect(applied.size).toBe(1);
  });

  it('concurrent delivery calls never deliver the same event twice at once', async () => {
    let calls = 0;
    const { writer, dispatcher } = setup({
      TransactionsChanged: [
        async () => {
          calls += 1;
          for (let i = 0; i < 5; i++) await Promise.resolve();
        },
      ],
    });
    await writer.run(raise('a'), undefined, 'user');
    const d = dispatcher();
    const results = await Promise.all([d.deliverPending(), d.deliverPending(), d.deliverPending()]);
    expect(calls).toBe(1);
    expect(results.map((r) => r.delivered)).toEqual([1, 0, 0]);
  });

  it('a handler that changes data runs a use case as its own transaction', async () => {
    const { db, writer } = setup();
    const follow: UseCase<void, void, never> = {
      name: 'Follow',
      async execute(ctx) {
        await ctx.execute('INSERT INTO ledger_test (v) VALUES (?)', ['follow-up']);
        ctx.touch('row', 'follow-up');
        return ok(undefined);
      },
    };
    const d = new OutboxDispatcher({
      db,
      clock: new FakeClock(2),
      logger: createRedactingLogger({ write: () => undefined }),
      handlers: { TransactionsChanged: [async () => void (await writer.run(follow, undefined, 'system'))] },
    });
    await writer.run(raise('a'), undefined, 'user');
    expect(await d.deliverPending()).toEqual({ delivered: 1, failed: 0 });
    expect(db.data).toEqual(['follow-up']);
    expect(db.audit.map((a) => [a.kind, a.actor])).toEqual([['Raise', 'user'], ['Follow', 'system']]);
  });

  it('an event name this version does not know is left pending, not dropped', async () => {
    const { db, dispatcher } = setup();
    db.state.outbox.push({ id: 'x', event: 'FromTheFuture', actor: 'system', payload_json: '{}', created_at: 1, delivered_at: null });
    expect(await dispatcher().deliverPending()).toEqual({ delivered: 0, failed: 1 });
    expect(db.outbox[0]!.delivered_at).toBeNull();
  });

  it('a corrupt payload is a failed delivery, not a crash', async () => {
    const { db, dispatcher } = setup({ TransactionsChanged: [() => undefined] });
    db.state.outbox.push({ id: 'x', event: 'TransactionsChanged', actor: 'user', payload_json: '{nope', created_at: 1, delivered_at: null });
    expect(await dispatcher().deliverPending()).toEqual({ delivered: 0, failed: 1 });
  });

  it('delivered events contain no amounts or text, only ids', async () => {
    const { db, writer } = setup();
    await writer.run(raise('uuid-1'), undefined, 'user');
    expect(db.outbox[0]!.payload_json).toBe('{"transactionIds":["uuid-1"]}');
  });
});
