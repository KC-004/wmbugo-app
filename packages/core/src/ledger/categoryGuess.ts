import { err, ok } from '../shared/result';
import type { UseCase, WriterContext } from '../writer/ledgerWriter';
import { categoryFits } from './categories';
import type { CategorySuggestion } from '../ports/categorySuggester';

/**
 * A suggested category is only ever a guess (Story 4.4, CAT-005). The user confirms it (`Looks right`) or changes it
 * (EditTransaction); either way the category is theirs from then on, and no automatic step may replace it.
 */

export type ConfirmCategoryError = 'ENTRY_NOT_FOUND' | 'ENTRY_REMOVED' | 'NOT_GUESSED';

/** The entry's only category, for entries with a single split. */
async function singleCategory(ctx: Pick<WriterContext, 'query'>, transactionId: string): Promise<string | null> {
  const rows = await ctx.query('SELECT category_id FROM split WHERE transaction_id = ?', [transactionId]);
  return rows.length === 1 ? String(rows[0]![0]) : null;
}

/**
 * `Looks right`: the user agrees with a guessed category. The category does not change; the guess flag is cleared and the
 * category is marked as the user's. `CategoryAssigned` carries the same category as before and after, with `wasGuessed`.
 */
export const ConfirmCategory: UseCase<{ transactionId: string }, { categoryId: string | null }, ConfirmCategoryError> = {
  name: 'ConfirmCategory',
  async execute(ctx, input) {
    const t = (await ctx.query('SELECT removed_at, category_guessed FROM "transaction" WHERE id = ?', [input.transactionId]))[0];
    if (!t) return err('ENTRY_NOT_FOUND');
    if (t[0] !== null) return err('ENTRY_REMOVED');
    if (Number(t[1]) !== 1) return err('NOT_GUESSED');
    const categoryId = await singleCategory(ctx, input.transactionId);
    await ctx.execute("UPDATE \"transaction\" SET category_guessed = 0, category_set_by = 'user', updated_at = ? WHERE id = ?", [ctx.nowMs(), input.transactionId]);
    ctx.touch('transaction', input.transactionId, { edited: true, fields: 'categoryConfirmed' });
    ctx.emit('TransactionsChanged', { transactionIds: [input.transactionId] });
    ctx.emit('CategoryAssigned', { transactionIds: [input.transactionId], previousCategoryId: categoryId, wasGuessed: true });
    return ok({ categoryId });
  },
};

export type ApplySuggestionError = 'ENTRY_NOT_FOUND' | 'ENTRY_REMOVED' | 'NOT_SUGGESTIBLE' | 'CATEGORY_NOT_FOUND' | 'CATEGORY_KIND_MISMATCH';

/**
 * An automatic step (re-classification, a re-submitted source, a later learner) offers a category for an entry that
 * already exists. The writer checks `category_set_by`: a category the user chose or confirmed is never replaced, and the
 * step is reported as `CATEGORY_USER_SET` (a normal outcome, not a failure). Only a single-category expense or income with
 * no user-set category is changed, and it becomes a guess again.
 */
export const ApplySuggestion: UseCase<{ transactionId: string; suggestion: CategorySuggestion }, { applied: boolean }, ApplySuggestionError | 'CATEGORY_USER_SET'> = {
  name: 'ApplySuggestion',
  async execute(ctx, input) {
    const t = (await ctx.query('SELECT event_type, removed_at, category_set_by FROM "transaction" WHERE id = ?', [input.transactionId]))[0];
    if (!t) return err('ENTRY_NOT_FOUND');
    if (t[1] !== null) return err('ENTRY_REMOVED');
    const type = String(t[0]);
    if (type !== 'expense' && type !== 'income') return err('NOT_SUGGESTIBLE');
    if (t[2] === 'user') return err('CATEGORY_USER_SET');
    const current = await singleCategory(ctx, input.transactionId);
    if (current === null) return err('NOT_SUGGESTIBLE');
    const k = (await ctx.query('SELECT kind FROM category WHERE id = ? AND archived = 0', [input.suggestion.categoryId]))[0];
    if (!k) return err('CATEGORY_NOT_FOUND');
    if (!categoryFits(String(k[0]), type)) return err('CATEGORY_KIND_MISMATCH');
    if (current === input.suggestion.categoryId) return ok({ applied: false });
    await ctx.execute('UPDATE split SET category_id = ? WHERE transaction_id = ?', [input.suggestion.categoryId, input.transactionId]);
    await ctx.execute("UPDATE \"transaction\" SET category_guessed = 1, category_set_by = 'suggester', needs_category = 0, updated_at = ? WHERE id = ?", [ctx.nowMs(), input.transactionId]);
    ctx.touch('transaction', input.transactionId, { edited: true, fields: 'category', suggested: true });
    ctx.emit('TransactionsChanged', { transactionIds: [input.transactionId] });
    ctx.emit('CategoryAssigned', { transactionIds: [input.transactionId], previousCategoryId: current, wasGuessed: false });
    return ok({ applied: true });
  },
};
