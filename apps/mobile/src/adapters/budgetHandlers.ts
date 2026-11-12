import type { budgetAlertHandlers, EventHandler, HandlerMap, Logger } from '@wmbugo/core';

/**
 * The invalidation handlers plus planning's: rebuild the budget periods on `ProfileChanged`, and the alert handlers
 * (Story 4.9). Anything that throws is logged (the event name only, never data) and never blocks the invalidation of screens;
 * the next change checks again. A crossing whose notification could not be posted is not retried (see deferred work).
 */
export function withBudgetHandlers(handlers: HandlerMap, rebuild: () => Promise<void>, alerts: ReturnType<typeof budgetAlertHandlers>, log: Logger): HandlerMap {
  const guard =
    (h: EventHandler): EventHandler =>
    async (e) => {
      try {
        await h(e);
      } catch {
        log.warn('budget.handler_failed', { event: e.name });
      }
    };
  return {
    ...handlers,
    ProfileChanged: [
      ...(handlers.ProfileChanged ?? []),
      () =>
        rebuild().catch(() => {
          log.warn('budget.rebuild_threw');
        }),
    ],
    TransactionsChanged: [...(handlers.TransactionsChanged ?? []), ...alerts.TransactionsChanged.map(guard)],
    BudgetsChanged: [...(handlers.BudgetsChanged ?? []), ...alerts.BudgetsChanged.map(guard)],
    BudgetThresholdCrossed: [...(handlers.BudgetThresholdCrossed ?? []), ...alerts.BudgetThresholdCrossed.map(guard)],
  };
}
