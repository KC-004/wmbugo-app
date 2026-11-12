/**
 * What the capture pipeline knows about an entry when it asks for a category (Story 4.4). Ids and kinds only; no
 * amount text reaches a log.
 */
export interface SuggestionFacts {
  readonly kind: 'expense' | 'income';
  readonly merchant: string | null;
  readonly amountMinor: number;
  readonly accountId: string | null;
  readonly sourceKind: string;
}

export interface CategorySuggestion {
  readonly categoryId: string;
  /** Why this category, for the user to read later (for example `Learned from your earlier entries`). */
  readonly reason: string;
}

/**
 * The `classify` stage's category port. The default adapter returns nothing: manual saves never get a suggestion.
 * Learning (Epic 11) provides the real adapter. A suggestion is only ever a guess: the user can always override it.
 */
export interface CategorySuggester {
  suggest(facts: SuggestionFacts): Promise<CategorySuggestion | null>;
}

export const noSuggester: CategorySuggester = { suggest: async () => null };
