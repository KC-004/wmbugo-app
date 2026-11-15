import type { HandlerMap, Logger } from '@wmbugo/core';

/**
 * Planning's handler of `TransactionsChanged` (Story 6.3): a linked entry that was deleted, rejected or excluded releases
 * its bill's due date. A failure is logged (the event name only) and never blocks the invalidation of screens; the next
 * change looks again, and releasing is idempotent.
 */
export function withBillHandlers(handlers: HandlerMap, release: () => Promise<void>, log: Logger): HandlerMap {
  return {
    ...handlers,
    TransactionsChanged: [
      ...(handlers.TransactionsChanged ?? []),
      () =>
        release().catch(() => {
          log.warn('bills.release_threw');
        }),
    ],
  };
}
