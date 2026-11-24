/**
 * Event catalogue (AD-4). Every outbox event is named here, in the past tense,
 * with the query areas it invalidates. `emit` is typed against this catalogue,
 * so an event that is not listed cannot be raised. Later epics add entries
 * (CapturesSubmitted, TransferLinked, ...) with the story that first raises them.
 */
export type QueryArea =
  | 'ledger'
  | 'budgets'
  | 'plan'
  | 'bills'
  | 'goals'
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
  TransactionsChanged: { areas: ['ledger', 'budgets', 'insights', 'home', 'widget', 'plan', 'bills', 'goals'] },
  AccountsChanged: { areas: ['ledger', 'insights', 'home', 'widget', 'plan', 'bills', 'goals'] },
  ProfileChanged: { areas: ['ledger', 'budgets', 'insights', 'home', 'periods', 'notifications', 'widget', 'plan'] },
  CapturesSubmitted: { areas: ['captures', 'ledger', 'home', 'widget'] },
  CapturesRejected: { areas: ['captures', 'ledger', 'home', 'widget'] },
  CategoryAssigned: { areas: ['learning', 'insights', 'budgets'] },
  /** A receipt line was given its own category by the person (Story 10.5): the item learning of Epic 11 reads it. */
  ReceiptItemCategorised: { areas: ['learning'] },
  CategoriesChanged: { areas: ['ledger', 'budgets', 'insights', 'home', 'plan', 'bills'] },
  BudgetsChanged: { areas: ['budgets', 'home', 'plan', 'insights'] },
  BudgetThresholdCrossed: { areas: ['notifications'] },
  RecurringChanged: { areas: ['bills', 'plan', 'home'] },
  GoalsChanged: { areas: ['goals', 'plan', 'home', 'insights'] },
  /** A saved CSV bank format was added or updated (Story 9.2): the capture queries (the import wizard's saved-layout lookup) refresh. */
  CsvFormatsChanged: { areas: ['captures'] },
  /** An import started, paused, resumed or finished (Story 9.4): Settings shows `Import paused`, and the wizard reads its progress. */
  ImportsChanged: { areas: ['captures'] },
  /** A restore replaced all the data (Story 8.8): every query is invalidated and bill reminders are scheduled again. */
  BackupRestored: { areas: ['ledger', 'budgets', 'plan', 'bills', 'goals', 'insights', 'home', 'widget', 'periods', 'notifications', 'captures', 'learning'] },
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
  /**
   * `previousCategoryId` and `wasGuessed` are the learning-from-corrections hook (Story 4.4): the category the entry had and
   * whether it was a guess nobody had confirmed. Confirming a guess (`Looks right`) carries the same category for both.
   */
  CategoryAssigned: { readonly transactionIds: readonly string[]; readonly previousCategoryId?: string | null; readonly wasGuessed?: boolean };
  /** The normalized item name, its category and who chose it (always the user): no amount, no shop, no photo. */
  ReceiptItemCategorised: { readonly transactionId: string; readonly itemKey: string; readonly categoryId: string; readonly actor: 'user' };
  /** Category ids only: pickers, Activity, budgets and insights refresh. */
  CategoriesChanged: { readonly categoryIds: readonly string[] };
  /** Budget ids only: the budget list, Home and Plan refresh. */
  BudgetsChanged: { readonly budgetIds: readonly string[] };
  /** Bill rule ids only (Story 6.1): the bills list, Plan and Home refresh; never an amount or a title. */
  RecurringChanged: { readonly ruleIds: readonly string[] };
  /** Goal ids only (Story 6.6): the goals list, Plan and Home refresh; never an amount or a name. */
  GoalsChanged: { readonly goalIds: readonly string[] };
  /** Import batch ids only: never a file name, a row or a count of money. */
  ImportsChanged: { readonly batchIds: readonly string[] };
  /** Format ids only: never a heading, a name or a mapping. */
  CsvFormatsChanged: { readonly formatIds: readonly string[] };
  /** Carries nothing: every area is stale. */
  BackupRestored: { readonly restored: true };
  /** The highest alert level a budget crossed in a period (Story 4.9): ids and the percentage only, never an amount. */
  BudgetThresholdCrossed: { readonly budgetId: string; readonly periodStart: string; readonly thresholdPct: number };
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
