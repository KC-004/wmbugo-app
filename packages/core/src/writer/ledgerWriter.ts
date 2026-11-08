import type { SqlParam, SqlTransaction, UnitOfWork } from '../ports/storage';
import type { Clock } from '../shared/clock';
import { redactEntry, type Logger, type LogValue } from '../shared/logger';
import { err, type Result } from '../shared/result';
import type { Actor, EventName, EventPayloads } from './events';

export type WriterErrorCode = 'INVARIANT_VIOLATED' | 'WRITE_FAILED';

export interface TouchedEntity {
  readonly entityKind: string;
  readonly entityId: string;
  readonly change: Record<string, LogValue>;
}

export interface RaisedEvent {
  readonly name: EventName;
  readonly payload: unknown;
}

/** What a use case sees while it runs inside the writer's single transaction. */
export interface WriterContext {
  readonly actor: Actor;
  query(sql: string, params?: readonly SqlParam[]): Promise<SqlParam[][]>;
  /** Every numeric parameter must be a safe integer: money and instants are never floats. */
  execute(sql: string, params?: readonly SqlParam[]): Promise<void>;
  /** Records that this use case changed an entity; one audit_event row is written per entity. */
  touch(entityKind: string, entityId: string, change?: Record<string, LogValue>): void;
  /** Raises a catalogue event; it is written to the outbox in the same transaction. */
  emit<E extends EventName>(name: E, payload: EventPayloads[E]): void;
  newId(): string;
  nowMs(): number;
}

/** A named unit of change. It never opens its own transaction. */
export interface UseCase<I, O, C extends string> {
  readonly name: string;
  execute(ctx: WriterContext, input: I): Promise<Result<O, C>>;
}

export interface InvariantContext {
  readonly useCase: string;
  readonly touched: readonly TouchedEntity[];
  readonly events: readonly RaisedEvent[];
  /** Reads inside the still-open transaction, so it sees the use case's own writes. */
  query(sql: string, params?: readonly SqlParam[]): Promise<SqlParam[][]>;
}

/** Registered checks run before commit. Return a description of the violation, or null. */
export interface Invariant {
  readonly name: string;
  check(ctx: InvariantContext): Promise<string | null>;
}

export interface LedgerWriterDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly logger: Logger;
  readonly invariants?: readonly Invariant[];
  /** Called after every successful commit (the app kicks outbox delivery here). */
  readonly onCommitted?: () => void;
  /**
   * Runs inside the same transaction, after the use case and the invariants, with everything the use case touched. The
   * Activity search index is kept up to date here, so a change and its index entry commit or roll back together.
   */
  readonly indexer?: (ctx: Pick<WriterContext, 'query' | 'execute'>, touched: readonly TouchedEntity[]) => Promise<void>;
}

class Abort extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function checkParams(params: readonly SqlParam[]): void {
  for (const p of params) {
    if (typeof p === 'number' && !Number.isSafeInteger(p)) throw new Abort('INVARIANT_VIOLATED');
  }
}

/**
 * The single writer (AD-4). One use case at a time, in submission order, each
 * in one transaction that also holds its audit rows and outbox events. Any
 * throw or failed invariant rolls the whole thing back.
 */
export class LedgerWriter {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: LedgerWriterDeps) {}

  run<I, O, C extends string>(useCase: UseCase<I, O, C>, input: I, actor: Actor): Promise<Result<O, C | WriterErrorCode>> {
    const result = this.tail.then(() => this.runOne(useCase, input, actor));
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async runOne<I, O, C extends string>(
    useCase: UseCase<I, O, C>,
    input: I,
    actor: Actor,
  ): Promise<Result<O, C | WriterErrorCode>> {
    const { uow, clock, newId, logger } = this.deps;
    let outcome: Result<O, C> | undefined;

    try {
      await uow.transaction(async (tx: SqlTransaction) => {
        const touched: TouchedEntity[] = [];
        const events: RaisedEvent[] = [];
        const ctx: WriterContext = {
          actor,
          query: (sql, params) => tx.query(sql, params),
          execute: (sql, params = []) => {
            checkParams(params);
            return tx.execute(sql, params);
          },
          touch: (entityKind, entityId, change = {}) => {
            touched.push({ entityKind, entityId, change });
          },
          emit: (name, payload) => {
            events.push({ name, payload });
          },
          newId,
          nowMs: () => clock.nowMs(),
        };

        const result = await useCase.execute(ctx, input);
        if (!result.ok) {
          outcome = result;
          throw new Abort(result.code); // roll back anything the use case wrote
        }

        for (const invariant of this.deps.invariants ?? []) {
          const violation = await invariant.check({ useCase: useCase.name, touched, events, query: (s, p) => tx.query(s, p) });
          if (violation !== null) {
            logger.error('writer.invariant_violated', { useCase: useCase.name, invariant: invariant.name });
            throw new Abort('INVARIANT_VIOLATED');
          }
        }

        if (this.deps.indexer) {
          await this.deps.indexer(
            { query: (q, p) => tx.query(q, p), execute: (q, p = []) => { checkParams(p); return tx.execute(q, p); } },
            touched,
          );
        }
        const at = clock.nowMs();
        const audited = touched.length > 0 ? touched : [{ entityKind: 'none', entityId: '', change: {} }];
        for (const t of audited) {
          const change = JSON.stringify(redactEntry('info', useCase.name, t.change).fields);
          checkParams([at]);
          await tx.execute(
            'INSERT INTO audit_event (id, kind, actor, entity_kind, entity_id, change_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [newId(), useCase.name, actor, t.entityKind, t.entityId, change, at],
          );
        }
        for (const e of events) {
          await tx.execute(
            'INSERT INTO outbox (id, event, actor, payload_json, created_at, delivered_at) VALUES (?, ?, ?, ?, ?, NULL)',
            [newId(), e.name, actor, JSON.stringify(e.payload), at],
          );
        }
        outcome = result;
      });
    } catch (e) {
      if (e instanceof Abort) {
        if (e.code === 'INVARIANT_VIOLATED') return err('INVARIANT_VIOLATED');
        if (outcome && !outcome.ok) return outcome; // the use case reported an expected failure
      }
      logger.error('writer.failed', { useCase: useCase.name });
      return err('WRITE_FAILED');
    }

    this.deps.onCommitted?.();
    return outcome as Result<O, C>;
  }
}
