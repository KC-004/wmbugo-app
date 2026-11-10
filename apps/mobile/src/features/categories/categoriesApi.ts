import {
  CATEGORY_LIST_SQL,
  mapCategoryRows,
  MoveCategory,
  SaveCategory,
  type CategoryRow,
  type MoveResult,
  type SaveCategoryError,
  type SaveCategoryInput,
} from '@wmbugo/core';
import { getServices } from '../../adapters/startApp';

export interface CategoriesData {
  /** Every active category, in sort order, both kinds and subcategories included. */
  readonly rows: CategoryRow[];
}

export type SaveOutcome = { ok: true; categoryId: string } | { ok: false; code: SaveCategoryError | string };
export type MoveOutcome = { ok: true; value: MoveResult } | { ok: false; code: string };

/** What the categories screen needs. The real one goes through the ledger writer; tests pass a fake. */
export interface CategoriesApi {
  load(): Promise<CategoriesData>;
  save(input: SaveCategoryInput): Promise<SaveOutcome>;
  move(categoryId: string, direction: 'up' | 'down', segment: 'expense' | 'income'): Promise<MoveOutcome>;
}

export const CATEGORIES_QUERY_KEY = ['ledger', 'categories'] as const;

export const realCategoriesApi: CategoriesApi = {
  async load() {
    return { rows: mapCategoryRows(await getServices().db.query(CATEGORY_LIST_SQL)) };
  },
  async save(input) {
    const r = await getServices().writer.run(SaveCategory, input, 'user');
    return r.ok ? { ok: true, categoryId: r.value.categoryId } : { ok: false, code: r.code };
  },
  async move(categoryId, direction, segment) {
    const r = await getServices().writer.run(MoveCategory, { categoryId, direction, segment }, 'user');
    return r.ok ? { ok: true, value: r.value } : { ok: false, code: r.code };
  },
};
