/**
 * Event catalogue (AD-4). Every outbox event is named here, in the past tense,
 * with the query areas it invalidates. `emit` is typed against this catalogue,
 * so an event that is not listed cannot be raised. Later epics add entries
 * (CapturesSubmitted, TransferLinked, ...) with the story that first raises them.
 */
export type QueryArea =
  | 'ledger'
  | 'budgets'
  | 'insights'
  | 'home'
  | 'widget'
  | 'periods'
  | 'notifications'
  | 'captures'
  | 'learning';

export interface EventSpec {
  /** Query areas (first element of every TanStack Query key) this event invalidates. */
  readonly areas: readonly QueryArea[];
}

export const EVENT_CATALOGUE = {
  TransactionsChanged: { areas: ['ledger', 'budgets', 'insights', 'home', 'widget'] },
  AccountsChanged: { areas: ['ledger', 'insights', 'home', 'widget'] },
  ProfileChanged: { areas: ['ledger', 'budgets', 'insights', 'home', 'periods', 'notifications', 'widget'] },
  CapturesSubmitted: { areas: ['captures', 'ledger', 'home', 'widget'] },
  CapturesRejected: { areas: ['captures', 'ledger', 'home', 'widget'] },
  CategoryAssigned: { areas: ['learning', 'insights', 'budgets'] },
} as const satisfies Record<string, EventSpec>;

export type EventName = keyof typeof EVENT_CATALOGUE;

/** Payloads carry ids and field names only, never amounts or text. */
export interface EventPayloads {
  /**
   * `closedPeriodTouched`: the change reached an entry of a period that has ended (a reversal or its Undo). Budget threshold
   * handlers never fire for such an event.
   */
  TransactionsChanged: { readonly transactionIds: readonly string[]; readonly closedPeriodTouched?: boolean };
  AccountsChanged: { readonly accountIds: readonly string[] };
  ProfileChanged: { readonly fields: readonly string[] };
  CapturesSubmitted: { readonly transactionIds: readonly string[] };
  CapturesRejected: { readonly transactionIds: readonly string[] };
  CategoryAssigned: { readonly transactionIds: readonly string[] };
}

// Compile-time check: the catalogue and the payload map list exactly the same events.
type SameKeys<A, B> = [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : never) : never;
export const CATALOGUE_MATCHES_PAYLOADS: SameKeys<typeof EVENT_CATALOGUE, EventPayloads> = true;

export type Actor = 'user' | 'auto' | 'system';

export interface EventEnvelope<E extends EventName = EventName> {
  readonly id: string;
  readonly name: E;
  readonly actor: Actor;
  readonly payload: EventPayloads[E];
  readonly createdAt: number;
}

export function isEventName(name: string): name is EventName {
  return Object.prototype.hasOwnProperty.call(EVENT_CATALOGUE, name);
}

/** Query areas an event invalidates. */
export function areasFor(name: EventName): readonly QueryArea[] {
  return EVENT_CATALOGUE[name].areas;
}
