import type { HandlerMap, Logger } from '@wmbugo/core';

/**
 * Makes the scheduled bill reminders match the bills (Story 6.5): after a bill changes, an entry changes (a linked payment
 * cancels its reminder) or the profile changes (a new timezone moves 09:00). Idempotent, so a failure only waits for the next
 * change, start or resume.
 */
export function withReminderSync(handlers: HandlerMap, sync: () => Promise<void>, log: Logger): HandlerMap {
  const run = () =>
    sync().catch(() => {
      log.warn('bills.reminder_sync_threw');
    });
  return {
    ...handlers,
    RecurringChanged: [...(handlers.RecurringChanged ?? []), run],
    TransactionsChanged: [...(handlers.TransactionsChanged ?? []), run],
    ProfileChanged: [...(handlers.ProfileChanged ?? []), run],
  };
}

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
