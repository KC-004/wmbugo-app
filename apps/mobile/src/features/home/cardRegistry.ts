import type { ComingUp, HomeBudgetCards, HomeCardSize, IncomeExpense, RegisteredCard, SavingsGoalCard, Spend7d, TopCategories } from '@wmbugo/core';
import { copy } from '../../shared/copy';

/**
 * The Home card registry (Story 5.4, UX-DR26). Each card declares a stable id, its title, when it shows, the sizes it supports
 * and where it drills down to, so a later story adds a card by adding an entry here without changing Home. The order of this
 * list is the default order (PRD 6.3): later stories append, and Edit Home (5.6) reorders and hides on top of it.
 */
export type CardId = 'to_check' | 'income_expense' | 'budgets' | 'nws' | 'top_categories' | 'spend_7d' | 'coming_up' | 'savings_goal';
/** `full` is the default; `compact` shows fewer rows (Story 5.6). Cards without a choice support `full` only. */
export type CardSize = HomeCardSize;
export type DrillDown = 'review_queue' | 'activity' | 'budget_detail' | 'plan';

/** What a card's visibility rule can look at. A card whose data is still loading or failed has `undefined`. */
export interface CardInputs {
  readonly toCheckCount: number;
  readonly income?: IncomeExpense | null;
  readonly budgets?: HomeBudgetCards | null;
  readonly topCategories?: TopCategories | null;
  readonly spend7d?: Spend7d | null;
  readonly comingUp?: ComingUp | null;
  readonly savingsGoal?: SavingsGoalCard | null;
}

export interface HomeCardDef {
  readonly id: CardId;
  /** The heading TalkBack announces. */
  readonly title: string;
  /** The sizes the card supports; the first is its default. */
  readonly sizes: readonly CardSize[];
  /** Whether Edit Home lists it. `N to check` is not listed: it always shows under the hero when something waits. */
  readonly editable: boolean;
  /** The short name Edit Home and its announcements use. */
  readonly editTitle: string;
  /** Said in Edit Home when the visibility rule is false right now, so the layout is ready for when it applies. */
  readonly whenHidden?: string;
  readonly drillDown: DrillDown;
  /** True when the card is worth showing. An empty card is not rendered at all (no empty card, no `0 to check`). */
  readonly visible: (inputs: CardInputs) => boolean;
}

export const HOME_CARDS: readonly HomeCardDef[] = [
  { id: 'to_check', title: copy.home.cards.thingsToCheck, editTitle: copy.home.cards.thingsToCheck, sizes: ['full'], editable: false, drillDown: 'review_queue', visible: (i) => i.toCheckCount > 0 },
  { id: 'income_expense', title: copy.home.cards.incomeExpense, editTitle: copy.home.cards.incomeExpense, sizes: ['full'], editable: true, drillDown: 'activity', visible: (i) => i.income !== null },
  { id: 'budgets', title: copy.home.cards.budgets, editTitle: copy.home.cards.budgets, sizes: ['full', 'compact'], editable: true, whenHidden: copy.home.edit.showsWhenBudget, drillDown: 'budget_detail', visible: (i) => (i.budgets?.categoryBudgets.length ?? 0) > 0 },
  { id: 'nws', title: copy.home.cards.nws, editTitle: copy.home.cards.nws, sizes: ['full'], editable: true, whenHidden: copy.home.edit.showsWhenFiftyThirtyTwenty, drillDown: 'plan', visible: (i) => i.budgets?.nws != null },
  { id: 'top_categories', title: copy.home.cards.topCategories, editTitle: copy.home.cards.topCategories, sizes: ['full', 'compact'], editable: true, drillDown: 'activity', visible: (i) => i.topCategories !== null },
  { id: 'spend_7d', title: copy.home.cards.spendLastWeek, editTitle: copy.home.cards.spendShort, sizes: ['full'], editable: true, drillDown: 'activity', visible: (i) => i.spend7d !== null },
  { id: 'coming_up', title: copy.home.cards.comingUp, editTitle: copy.home.cards.comingUp, sizes: ['full'], editable: true, whenHidden: copy.home.edit.showsWhenBill, drillDown: 'plan', visible: (i) => i.comingUp != null },
  { id: 'savings_goal', title: copy.home.cards.savingsGoal, editTitle: copy.home.cards.savingsGoal, sizes: ['full'], editable: true, whenHidden: copy.home.edit.showsWhenGoal, drillDown: 'plan', visible: (i) => i.savingsGoal != null },
];

/** The cards Edit Home lists, in PRD order, as the layout resolver wants them. */
export const EDITABLE_CARDS: readonly HomeCardDef[] = HOME_CARDS.filter((c) => c.editable);
export const REGISTERED_FOR_LAYOUT: readonly RegisteredCard[] = EDITABLE_CARDS.map((c) => ({ id: c.id, defaultSize: c.sizes[0]!, sizes: c.sizes }));

/** The cards that show now, in registry order. */
export const visibleCards = (inputs: CardInputs): readonly HomeCardDef[] => HOME_CARDS.filter((c) => c.visible(inputs));
