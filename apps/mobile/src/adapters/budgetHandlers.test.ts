import type { EventEnvelope, EventHandler, HandlerMap, Logger } from '@wmbugo/core';
import { withBudgetHandlers } from './budgetHandlers';

const event = (name: EventEnvelope['name']): EventEnvelope => ({ id: 'e1', name, actor: 'user', payload: {}, createdAt: 1 }) as unknown as EventEnvelope;
const logger = (): Logger & { warn: jest.Mock } => ({ log: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() });
const alerts = (over: Partial<Record<'TransactionsChanged' | 'BudgetsChanged' | 'BudgetThresholdCrossed', EventHandler[]>> = {}) => ({
  TransactionsChanged: [jest.fn()] as EventHandler[],
  BudgetsChanged: [jest.fn()] as EventHandler[],
  BudgetThresholdCrossed: [jest.fn()] as EventHandler[],
  ...over,
});

describe('the budget handlers composed onto the invalidation handlers (Epic 4 review)', () => {
  it('ProfileChanged runs the period rebuild after the invalidation handler, so a period-mode or week-start change rebuilds the cache', async () => {
    const order: string[] = [];
    const base: HandlerMap = { ProfileChanged: [() => void order.push('invalidate')] };
    const rebuild = jest.fn(async () => void order.push('rebuild'));
    const map = withBudgetHandlers(base, rebuild, alerts(), logger());
    for (const h of map.ProfileChanged ?? []) await h(event('ProfileChanged'));
    expect(order).toEqual(['invalidate', 'rebuild']);
  });

  it('a throwing rebuild is logged and does not throw; screens were already invalidated', async () => {
    const log = logger();
    const base: HandlerMap = { ProfileChanged: [jest.fn()] };
    const map = withBudgetHandlers(base, async () => Promise.reject(new Error('boom')), alerts(), log);
    for (const h of map.ProfileChanged ?? []) await expect(Promise.resolve(h(event('ProfileChanged')))).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith('budget.rebuild_threw');
  });

  it('a throwing alert handler is logged by event name and never blocks the invalidation handler or the next one', async () => {
    const log = logger();
    const invalidate = jest.fn();
    const base: HandlerMap = { TransactionsChanged: [invalidate] };
    const boom = jest.fn(async () => Promise.reject(new Error('post failed')));
    const after = jest.fn();
    const map = withBudgetHandlers(base, async () => undefined, alerts({ TransactionsChanged: [boom, after] }), log);
    for (const h of map.TransactionsChanged ?? []) await h(event('TransactionsChanged'));
    expect(invalidate).toHaveBeenCalled();
    expect(boom).toHaveBeenCalled();
    expect(after).toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith('budget.handler_failed', { event: 'TransactionsChanged' });
  });

  it('each alert event gets its alert handler, and events without one keep only the invalidation handlers', async () => {
    const a = alerts();
    const map = withBudgetHandlers({ AccountsChanged: [jest.fn()] }, async () => undefined, a, logger());
    expect(map.TransactionsChanged).toHaveLength(1);
    expect(map.BudgetsChanged).toHaveLength(1);
    expect(map.BudgetThresholdCrossed).toHaveLength(1);
    expect(map.AccountsChanged).toHaveLength(1);
    await map.BudgetThresholdCrossed![0]!(event('BudgetThresholdCrossed'));
    expect(a.BudgetThresholdCrossed[0]).toHaveBeenCalled();
  });
});
