import { create } from 'zustand';
import type { ActivityQuery } from '@wmbugo/core';

/** The Add sheet's draft: what was typed, kept in memory only (never persisted, gone after process death). */
export interface AddDraft {
  readonly kind: 'expense' | 'income' | 'transfer';
  /** Keypad text, '.' as the only separator. */
  readonly typedText: string;
  readonly categoryId: string | null;
}

export const EMPTY_DRAFT: AddDraft = { kind: 'expense', typedText: '', categoryId: null };

/** Which date preset produced the query's date range (the range itself is in the query). */
export type DatePreset = 'period' | '7d' | '30d' | 'custom' | null;

/** Activity's search and filters: kept across tab switches, gone after process death (never stored). */
export interface ActivityFilterState {
  readonly query: ActivityQuery;
  readonly datePreset: DatePreset;
}

export const EMPTY_ACTIVITY_FILTER: ActivityFilterState = { query: {}, datePreset: null };

/**
 * Transient UI state (see README.md in this folder): the open-sheet id and the Add draft.
 * Nothing monetary or persistent lives here.
 */
export interface UiState {
  readonly openSheet: string | null;
  readonly addDraft: AddDraft;
  readonly activityFilter: ActivityFilterState;
  setActivityFilter(next: ActivityFilterState): void;
  openSheetById(id: string): void;
  closeSheet(): void;
  setAddDraft(patch: Partial<AddDraft>): void;
  clearAddDraft(): void;
}

export const useUiStore = create<UiState>((set) => ({
  openSheet: null,
  addDraft: EMPTY_DRAFT,
  activityFilter: EMPTY_ACTIVITY_FILTER,
  setActivityFilter: (next) => set({ activityFilter: next }),
  openSheetById: (id) => set({ openSheet: id }),
  closeSheet: () => set({ openSheet: null }),
  setAddDraft: (patch) => set((s) => ({ addDraft: { ...s.addDraft, ...patch } })),
  clearAddDraft: () => set({ addDraft: EMPTY_DRAFT }),
}));
