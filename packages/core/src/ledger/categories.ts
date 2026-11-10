export type CategoryKind = 'expense' | 'income' | 'mixed';

/** An expense entry takes expense and mixed categories; an income entry takes income and mixed ones (CAT-003). */
export const categoryFits = (categoryKind: string, entryType: string): boolean =>
  categoryKind === 'mixed' ? entryType === 'expense' || entryType === 'income' : categoryKind === entryType;

/** Two kinds share a picker (and so a name space) when either is mixed or they are equal. */
export const kindsOverlap = (a: string, b: string): boolean => a === 'mixed' || b === 'mixed' || a === b;

/** The kinds a picker or segment for this entry type lists. */
export const kindsFor = (entryType: 'expense' | 'income'): readonly CategoryKind[] => [entryType, 'mixed'];
export type BudgetType = 'need' | 'want';

export interface SeedCategory {
  readonly id: string;
  readonly name: string;
  readonly kind: CategoryKind;
  readonly budgetType: BudgetType | null;
  /** Phosphor icon name. */
  readonly icon: string;
  /** DESIGN.md categorical colour token. */
  readonly color: string;
}

/** The seeded categories, in seed order (CAT-001). Ids are stable so migrations and code agree. */
export const SEED_CATEGORIES: readonly SeedCategory[] = [
  { id: 'cat_food', name: 'Food & Drinks', kind: 'expense', budgetType: 'want', icon: 'ForkKnife', color: 'cat-rose' },
  { id: 'cat_groceries', name: 'Groceries', kind: 'expense', budgetType: 'need', icon: 'ShoppingCart', color: 'cat-lime' },
  { id: 'cat_transport', name: 'Transport', kind: 'expense', budgetType: 'need', icon: 'Bus', color: 'cat-sky' },
  { id: 'cat_housing', name: 'Housing', kind: 'expense', budgetType: 'need', icon: 'House', color: 'cat-brown' },
  { id: 'cat_bills', name: 'Bills & Utilities', kind: 'expense', budgetType: 'need', icon: 'Receipt', color: 'cat-cyan' },
  { id: 'cat_shopping', name: 'Shopping', kind: 'expense', budgetType: 'want', icon: 'ShoppingBag', color: 'cat-fuchsia' },
  { id: 'cat_health', name: 'Healthcare', kind: 'expense', budgetType: 'need', icon: 'Heartbeat', color: 'cat-pink' },
  { id: 'cat_entertainment', name: 'Entertainment', kind: 'expense', budgetType: 'want', icon: 'FilmSlate', color: 'cat-indigo' },
  { id: 'cat_education', name: 'Education', kind: 'expense', budgetType: 'need', icon: 'GraduationCap', color: 'cat-olive' },
  { id: 'cat_travel', name: 'Travel', kind: 'expense', budgetType: 'want', icon: 'Airplane', color: 'cat-emerald' },
  { id: 'cat_personal', name: 'Personal Care', kind: 'expense', budgetType: 'want', icon: 'Flower', color: 'cat-rose' },
  { id: 'cat_family', name: 'Family', kind: 'expense', budgetType: null, icon: 'UsersThree', color: 'cat-stone' },
  { id: 'cat_other', name: 'Other', kind: 'expense', budgetType: null, icon: 'DotsThree', color: 'cat-slate' },
  { id: 'cat_uncategorised', name: 'Uncategorised', kind: 'expense', budgetType: null, icon: 'Question', color: 'cat-slate' },
  { id: 'cat_in_salary', name: 'Salary', kind: 'income', budgetType: null, icon: 'Briefcase', color: 'cat-emerald' },
  { id: 'cat_in_freelance', name: 'Freelance', kind: 'income', budgetType: null, icon: 'Laptop', color: 'cat-cyan' },
  { id: 'cat_in_people', name: 'From people', kind: 'income', budgetType: null, icon: 'HandHeart', color: 'cat-pink' },
  { id: 'cat_in_gifts', name: 'Gifts', kind: 'income', budgetType: null, icon: 'Gift', color: 'cat-fuchsia' },
  { id: 'cat_in_interest', name: 'Interest', kind: 'income', budgetType: null, icon: 'Percent', color: 'cat-lime' },
  { id: 'cat_in_refunds', name: 'Refunds', kind: 'income', budgetType: null, icon: 'ArrowUUpLeft', color: 'cat-sky' },
];

export const UNCATEGORISED_ID = 'cat_uncategorised';

export interface CategoryRow {
  readonly id: string;
  readonly name: string;
  readonly kind: CategoryKind;
  readonly budgetType: BudgetType | null;
  readonly icon: string;
  readonly colorToken: string;
  readonly sortOrder: number;
  /** The parent of a subcategory (one level only); null for a top-level category. */
  readonly parentId: string | null;
}

export const CATEGORY_LIST_SQL =
  'SELECT id, name, kind, budget_type, icon, color_token, sort_order, parent_id FROM category WHERE archived = 0 ORDER BY sort_order, id';

export function mapCategoryRows(rows: readonly (readonly unknown[])[]): CategoryRow[] {
  return rows.map((r) => ({
    id: String(r[0]),
    name: String(r[1]),
    kind: String(r[2]) as CategoryKind,
    budgetType: r[3] === null || r[3] === undefined ? null : (String(r[3]) as BudgetType),
    icon: String(r[4]),
    colorToken: String(r[5]),
    sortOrder: Number(r[6]),
    parentId: r[7] === null || r[7] === undefined ? null : String(r[7]),
  }));
}

/** How many live (not removed) entries use each category. */
export const CATEGORY_USE_SQL =
  'SELECT s.category_id, COUNT(*) FROM split s JOIN "transaction" t ON t.id = s.transaction_id WHERE t.removed_at IS NULL GROUP BY s.category_id';

/**
 * Orders categories for the quick chips: most used first, seed order breaking ties (so a new profile sees
 * the seed order). Uncategorised is never offered as a quick chip.
 */
export function rankCategories(categories: readonly CategoryRow[], useCounts: ReadonlyMap<string, number>): CategoryRow[] {
  return categories
    .filter((c) => c.id !== UNCATEGORISED_ID)
    .map((c, seed) => ({ c, seed, n: useCounts.get(c.id) ?? 0 }))
    .sort((a, b) => b.n - a.n || a.seed - b.seed)
    .map((x) => x.c);
}

const DAY_MS = 86_400_000;

/** The quick-chip order is recalculated at most once a day and never while a sheet is open. */
export function rankIsStale(computedAtMs: number | null, nowMs: number): boolean {
  return computedAtMs === null || nowMs - computedAtMs >= DAY_MS || nowMs < computedAtMs;
}
