import { FakeClock } from '../shared/clock';
import { createRedactingLogger, type LogEntry } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { ok } from '../shared/result';
import { EVENT_CATALOGUE, areasFor, isEventName } from './events';
import { LedgerWriter, type Invariant, type UseCase } from './ledgerWriter';
import { MemoryDatabase } from './fakes';

function setup(invariants: Invariant[] = []) {
  const db = new MemoryDatabase();
  const clock = new FakeClock(1_700_000_000_000);
  const entries: LogEntry[] = [];
  const committed = jest.fn();
  const writer = new LedgerWriter({
    uow: db,
    clock,
    newId: createIdGenerator(clock, seededRandom(1)),
    logger: createRedactingLogger({ write: (e) => entries.push(e) }),
    invariants,
    onCommitted: committed,
  });
  return { db, clock, entries, committed, writer };
}

const insertRow = (v: string): UseCase<void, string, never> => ({
  name: 'InsertRow',
  async execute(ctx) {
    await ctx.execute('INSERT INTO ledger_test (v) VALUES (?)', [v]);
    ctx.touch('row', v, { amountMinor: 123456, note: 'secret note', kind: 'test' });
    ctx.emit('TransactionsChanged', { transactionIds: [v] });
    return ok(v);
  },
});

describe('LedgerWriter', () => {
  it('commits data, audit rows and outbox events together', async () => {
    const { db, writer, committed } = setup();
    const r = await writer.run(insertRow('t1'), undefined, 'user');
    expect(r).toEqual({ ok: true, value: 't1' });
    expect(db.data).toEqual(['t1']);
    expect(db.audit).toHaveLength(1);
    expect(db.audit[0]).toMatchObject({ kind: 'InsertRow', actor: 'user', entity_kind: 'row', entity_id: 't1', created_at: 1_700_000_000_000 });
    expect(db.outbox).toHaveLength(1);
    expect(db.outbox[0]).toMatchObject({ event: 'TransactionsChanged', actor: 'user', delivered_at: null });
    expect(JSON.parse(db.outbox[0]!.payload_json)).toEqual({ transactionIds: ['t1'] });
    expect(committed).toHaveBeenCalledTimes(1);
  });

  it('redacts amounts and notes in the audit change before storing them', async () => {
    const { db, writer } = setup();
    await writer.run(insertRow('t1'), undefined, 'auto');
    const change = JSON.parse(db.audit[0]!.change_json);
    expect(change).toEqual({ amountMinor: '[redacted]', note: '[redacted]', kind: 'test' });
    expect(db.audit[0]!.actor).toBe('auto');
  });

  it('runs one use case at a time, in submission order', async () => {
    const { db, writer } = setup();
    const order: string[] = [];
    const slow = (name: string): UseCase<void, string, never> => ({
      name,
      async execute(ctx) {
        order.push(`start ${name}`);
        for (let i = 0; i < 5; i++) await Promise.resolve();
        await ctx.execute('INSERT INTO ledger_test (v) VALUES (?)', [name]);
        order.push(`end ${name}`);
        return ok(name);
      },
    });
    await Promise.all(['a', 'b', 'c', 'd', 'e'].map((n) => writer.run(slow(n), undefined, 'user')));
    expect(db.maxActive).toBe(1);
    expect(db.data).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(order).toEqual(['a', 'b', 'c', 'd', 'e'].flatMap((n) => [`start ${n}`, `end ${n}`]));
  });

  it('fault injection: a use case that throws midway leaves no data, audit or outbox row', async () => {
    const { db, writer, committed } = setup();
    const boom: UseCase<void, never, never> = {
      name: 'Boom',
      async execute(ctx) {
        await ctx.execute('INSERT INTO ledger_test (v) VALUES (?)', ['half']);
        ctx.touch('row', 'half');
        ctx.emit('TransactionsChanged', { transactionIds: ['half'] });
        throw new Error('crash midway');
      },
    };
    expect(await writer.run(boom, undefined, 'user')).toEqual({ ok: false, code: 'WRITE_FAILED' });
    expect(db.data).toEqual([]);
    expect(db.audit).toEqual([]);
    expect(db.outbox).toEqual([]);
    expect(committed).not.toHaveBeenCalled();
    // The queue is not poisoned: the next use case still runs.
    expect(await writer.run(insertRow('ok'), undefined, 'user')).toEqual({ ok: true, value: 'ok' });
    expect(db.data).toEqual(['ok']);
  });

  it('a use case that reports an expected failure is rolled back and returns its code', async () => {
    const { db, writer, committed } = setup();
    const nope: UseCase<void, never, 'SAME_ACCOUNT'> = {
      name: 'Nope',
      async execute(ctx) {
        await ctx.execute('INSERT INTO ledger_test (v) VALUES (?)', ['x']);
        return { ok: false, code: 'SAME_ACCOUNT' };
      },
    };
    expect(await writer.run(nope, undefined, 'user')).toEqual({ ok: false, code: 'SAME_ACCOUNT' });
    expect(db.data).toEqual([]);
    expect(db.audit).toEqual([]);
    expect(committed).not.toHaveBeenCalled();
  });

  it('a failing invariant returns INVARIANT_VIOLATED and rolls back, seeing the use case\'s own writes', async () => {
    const seen: number[] = [];
    const atMostTwo: Invariant = {
      name: 'atMostTwoRows',
      async check(ctx) {
        const rows = await ctx.query('SELECT v FROM ledger_test');
        seen.push(rows.length);
        return rows.length > 2 ? 'too many' : null;
      },
    };
    const { db, writer, entries } = setup([atMostTwo]);
    const three: UseCase<void, void, never> = {
      name: 'Three',
      async execute(ctx) {
        for (const v of ['1', '2', '3']) await ctx.execute('INSERT INTO ledger_test (v) VALUES (?)', [v]);
        ctx.touch('row', '3');
        return ok(undefined);
      },
    };
    expect(await writer.run(three, undefined, 'user')).toEqual({ ok: false, code: 'INVARIANT_VIOLATED' });
    expect(seen).toEqual([3]);
    expect(db.data).toEqual([]);
    expect(db.audit).toEqual([]);
    expect(entries.map((e) => e.event)).toContain('writer.invariant_violated');
    expect(entries.find((e) => e.event === 'writer.invariant_violated')!.fields).toEqual({ useCase: 'Three', invariant: 'atMostTwoRows' });
    // A conforming use case passes the same invariant.
    expect((await writer.run(insertRow('fine'), undefined, 'user')).ok).toBe(true);
  });

  it('invariants can inspect what was touched and which events were raised', async () => {
    let ctxSeen: { touched: number; events: number; name: string } | undefined;
    const spy: Invariant = {
      name: 'spy',
      async check(ctx) {
        ctxSeen = { touched: ctx.touched.length, events: ctx.events.length, name: ctx.useCase };
        return null;
      },
    };
    const { writer } = setup([spy]);
    await writer.run(insertRow('t'), undefined, 'user');
    expect(ctxSeen).toEqual({ touched: 1, events: 1, name: 'InsertRow' });
  });

  it.each([1.5, NaN, Infinity, 2 ** 60, -(2 ** 53)])('rejects the non-safe-integer amount %p and rolls back', async (bad) => {
    const { db, writer } = setup();
    const uc: UseCase<void, void, never> = {
      name: 'BadAmount',
      async execute(ctx) {
        await ctx.execute('INSERT INTO ledger_test (v) VALUES (?)', ['before']);
        await ctx.execute('INSERT INTO ledger_test (v) VALUES (?)', [bad]);
        return ok(undefined);
      },
    };
    expect(await writer.run(uc, undefined, 'user')).toEqual({ ok: false, code: 'INVARIANT_VIOLATED' });
    expect(db.data).toEqual([]);
  });

  it('accepts safe integers, strings and null', async () => {
    const { db, writer } = setup();
    const uc: UseCase<void, void, never> = {
      name: 'GoodParams',
      async execute(ctx) {
        await ctx.execute('INSERT INTO ledger_test (v) VALUES (?)', [Number.MAX_SAFE_INTEGER]);
        await ctx.execute('INSERT INTO ledger_test (v) VALUES (?)', [null]);
        await ctx.execute('INSERT INTO ledger_test (v) VALUES (?)', ['s']);
        return ok(undefined);
      },
    };
    expect((await writer.run(uc, undefined, 'system')).ok).toBe(true);
    expect(db.data).toHaveLength(3);
  });

  it('writes one audit row per touched entity, or one placeholder row when nothing was touched', async () => {
    const { db, writer } = setup();
    const multi: UseCase<void, void, never> = {
      name: 'Multi',
      async execute(ctx) {
        ctx.touch('account', 'a1');
        ctx.touch('transaction', 't1');
        return ok(undefined);
      },
    };
    await writer.run(multi, undefined, 'user');
    expect(db.audit.map((a) => [a.entity_kind, a.entity_id])).toEqual([['account', 'a1'], ['transaction', 't1']]);
    const none: UseCase<void, void, never> = { name: 'None', execute: async () => ok(undefined) };
    await writer.run(none, undefined, 'system');
    expect(db.audit.at(-1)).toMatchObject({ kind: 'None', entity_kind: 'none', actor: 'system' });
  });

  it('gives every row a unique, increasing UUID v7 id', async () => {
    const { db, writer } = setup();
    for (let i = 0; i < 20; i++) await writer.run(insertRow(`r${i}`), undefined, 'user');
    const ids = [...db.audit.map((a) => a.id), ...db.outbox.map((o) => o.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-7/.test(id))).toBe(true);
  });

  it('the event type is checked against the catalogue', () => {
    const uc: UseCase<void, void, never> = {
      name: 'Types',
      async execute(ctx) {
        // @ts-expect-error not in the catalogue
        ctx.emit('NotARealEvent', {});
        // @ts-expect-error wrong payload for the event
        ctx.emit('TransactionsChanged', { fields: [] });
        return ok(undefined);
      },
    };
    expect(uc.name).toBe('Types');
  });
});

describe('event catalogue', () => {
  const names = Object.keys(EVENT_CATALOGUE);

  it('contains TransactionsChanged and ProfileChanged with non-empty areas', () => {
    expect(names).toEqual(expect.arrayContaining(['TransactionsChanged', 'ProfileChanged']));
    for (const n of names) expect(areasFor(n as keyof typeof EVENT_CATALOGUE).length).toBeGreaterThan(0);
  });

  it('uses past-tense names', () => {
    for (const n of names) expect(n).toMatch(/(Changed|Submitted|AutoApproved|Rejected|Linked|Unlinked|Assigned|Crossed|Restored)$/);
  });

  it('maps TransactionsChanged to ledger, budgets, insights, home and widget only', () => {
    expect([...areasFor('TransactionsChanged')].sort()).toEqual(['budgets', 'home', 'insights', 'ledger', 'widget']);
  });

  it('recognises only catalogue names', () => {
    expect(isEventName('ProfileChanged')).toBe(true);
    expect(isEventName('toString')).toBe(false);
    expect(isEventName('Nope')).toBe(false);
  });
});
