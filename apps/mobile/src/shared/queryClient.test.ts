import type { QueryClient } from '@tanstack/react-query';
import type { EventEnvelope, EventName, QueryArea } from '@wmbugo/core';
import { createQueryClient, invalidationHandlers } from './queryClient';

const AREAS: QueryArea[] = ['ledger', 'budgets', 'insights', 'home', 'widget', 'periods', 'notifications', 'captures', 'learning'];

const clients: QueryClient[] = [];
afterEach(() => {
  // Cached queries schedule garbage-collection timers; clear them so Jest can exit.
  for (const c of clients.splice(0)) c.clear();
});

function seeded(): QueryClient {
  const qc = createQueryClient();
  clients.push(qc);
  for (const a of AREAS) qc.setQueryData([a, 'sample'], { value: 1 });
  qc.setQueryData(['ledger'], { value: 1 }); // bare area key too
  return qc;
}

const invalidated = (qc: QueryClient): QueryArea[] =>
  AREAS.filter((a) => qc.getQueryState([a, 'sample'])?.isInvalidated === true).sort();

const envelope = (name: EventName): EventEnvelope => ({
  id: 'e1',
  name,
  actor: 'user',
  payload: name === 'ProfileChanged' ? { fields: ['payday'] } : { transactionIds: ['t1'] },
  createdAt: 1,
}) as EventEnvelope;

describe('query client', () => {
  it('uses networkMode "always" because there is no network', () => {
    const qc = createQueryClient();
    expect(qc.getDefaultOptions().queries?.networkMode).toBe('always');
    expect(qc.getDefaultOptions().mutations?.networkMode).toBe('always');
  });

  it('TransactionsChanged invalidates only ledger, budgets, insights, home and widget', async () => {
    const qc = seeded();
    await invalidationHandlers(qc).TransactionsChanged![0]!(envelope('TransactionsChanged'));
    expect(invalidated(qc)).toEqual(['budgets', 'home', 'insights', 'ledger', 'widget']);
    expect(qc.getQueryState(['ledger'])?.isInvalidated).toBe(true);
  });

  it('ProfileChanged invalidates the period-based areas and notifications, not captures or learning', async () => {
    const qc = seeded();
    await invalidationHandlers(qc).ProfileChanged![0]!(envelope('ProfileChanged'));
    expect(invalidated(qc)).toEqual(['budgets', 'home', 'insights', 'ledger', 'notifications', 'periods', 'widget']);
    expect(qc.getQueryState(['captures', 'sample'])?.isInvalidated).toBe(false);
    expect(qc.getQueryState(['learning', 'sample'])?.isInvalidated).toBe(false);
  });

  it('every catalogue event has a handler', () => {
    expect(Object.keys(invalidationHandlers(createQueryClient())).sort()).toEqual(['ProfileChanged', 'TransactionsChanged']);
  });

  it('invalidating twice (redelivery) is harmless', async () => {
    const qc = seeded();
    const h = invalidationHandlers(qc).TransactionsChanged![0]!;
    await h(envelope('TransactionsChanged'));
    await h(envelope('TransactionsChanged'));
    expect(invalidated(qc)).toEqual(['budgets', 'home', 'insights', 'ledger', 'widget']);
  });
});
