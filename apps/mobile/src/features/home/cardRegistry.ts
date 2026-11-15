import type { HomeBudgetCards, IncomeExpense } from '@wmbugo/core';
import { copy } from '../../shared/copy';

/**
 * The Home card registry (Story 5.4, UX-DR26). Each card declares a stable id, its title, when it shows, the sizes it supports
 * and where it drills down to, so a later story adds a card by adding an entry here without changing Home. The order of this
 * list is the default order (PRD 6.3): later stories append, and Edit Home (5.6) reorders and hides on top of it.
 */
export type CardId = 'to_check' | 'income_expense' | 'budgets' | 'nws';
export type CardSize = 'standard' | 'compact';
export type DrillDown = 'review_queue' | 'activity' | 'budget_detail' | 'plan';

/** What a card's visibility rule can look at. A card whose data is still loading or failed has `undefined`. */
export interface CardInputs {
  readonly toCheckCount: number;
  readonly income?: IncomeExpense | null;
  readonly budgets?: HomeBudgetCards | null;
}

export interface HomeCardDef {
  readonly id: CardId;
  /** The heading TalkBack announces. */
  readonly title: string;
  readonly sizes: readonly CardSize[];
  readonly drillDown: DrillDown;
  /** True when the card is worth showing. An empty card is not rendered at all (no empty card, no `0 to check`). */
  readonly visible: (inputs: CardInputs) => boolean;
}

export const HOME_CARDS: readonly HomeCardDef[] = [
  { id: 'to_check', title: copy.home.cards.thingsToCheck, sizes: ['compact'], drillDown: 'review_queue', visible: (i) => i.toCheckCount > 0 },
  { id: 'income_expense', title: copy.home.cards.incomeExpense, sizes: ['standard'], drillDown: 'activity', visible: (i) => i.income !== null },
  { id: 'budgets', title: copy.home.cards.budgets, sizes: ['standard'], drillDown: 'budget_detail', visible: (i) => (i.budgets?.categoryBudgets.length ?? 0) > 0 },
  { id: 'nws', title: copy.home.cards.nws, sizes: ['standard'], drillDown: 'plan', visible: (i) => i.budgets?.nws != null },
];

/** The cards that show now, in registry order. */
export const visibleCards = (inputs: CardInputs): readonly HomeCardDef[] => HOME_CARDS.filter((c) => c.visible(inputs));
