import type { SqlDatabase } from '../ports/storage';
import type { Clock } from '../shared/clock';
import type { Logger } from '../shared/logger';
import { isEventName, type Actor, type EventEnvelope, type EventName } from './events';

/**
 * Handlers must be idempotent on `event.id`: delivery is at-least-once, so the
 * same event can arrive again after a crash. A handler that changes data does
 * so by running a use case through the LedgerWriter (its own transaction).
 */
export type EventHandler = (event: EventEnvelope) => Promise<void> | void;
export type HandlerMap = Partial<Record<EventName, readonly EventHandler[]>>;

export interface DeliveryReport {
  readonly delivered: number;
  readonly failed: number;
}

export interface OutboxDispatcherDeps {
  readonly db: Pick<SqlDatabase, 'query' | 'transaction'>;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly handlers: HandlerMap;
}

/**
 * Delivers committed outbox events in creation order. An event is marked
 * delivered only after every handler returned, so a crash (or a throwing
 * handler) leaves it pending and it is delivered again on the next run, which
 * the app starts after commit and on every launch.
 */
export class OutboxDispatcher {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: OutboxDispatcherDeps) {}

  /** Serialised: concurrent calls queue, so one event is never delivered twice at once. */
  deliverPending(): Promise<DeliveryReport> {
    const run = this.tail.then(() => this.deliverOnce());
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async deliverOnce(): Promise<DeliveryReport> {
    const { db, clock, logger, handlers } = this.deps;
    const rows = await db.query(
      'SELECT id, event, actor, payload_json, created_at FROM outbox WHERE delivered_at IS NULL ORDER BY created_at, id',
    );
    let delivered = 0;
    for (const row of rows) {
      const id = String(row[0]);
      const name = String(row[1]);
      if (!isEventName(name)) {
        logger.error('outbox.unknown_event');
        return { delivered, failed: rows.length - delivered };
      }
      try {
        const event: EventEnvelope = {
          id,
          name,
          actor: String(row[2]) as Actor,
          payload: JSON.parse(String(row[3])) as EventEnvelope['payload'],
          createdAt: Number(row[4]),
        };
        for (const handler of handlers[name] ?? []) await handler(event);
        await db.transaction(async (tx) => {
          await tx.execute('UPDATE outbox SET delivered_at = ? WHERE id = ?', [clock.nowMs(), id]);
        });
        delivered += 1;
      } catch {
        // Stop at the first failure to keep order; the rest stays pending for the next run.
        logger.error('outbox.handler_failed', { event: name });
        return { delivered, failed: rows.length - delivered };
      }
    }
    return { delivered, failed: 0 };
  }
}
