import { create } from 'zustand';

/** The Add sheet's draft: what was typed, kept in memory only (never persisted, gone after process death). */
export interface AddDraft {
  readonly kind: 'expense' | 'income' | 'transfer';
  /** Keypad text, '.' as the only separator. */
  readonly typedText: string;
  readonly categoryId: string | null;
}

export const EMPTY_DRAFT: AddDraft = { kind: 'expense', typedText: '', categoryId: null };

/**
 * Transient UI state (see README.md in this folder): the open-sheet id and the Add draft.
 * Nothing monetary or persistent lives here.
 */
export interface UiState {
  readonly openSheet: string | null;
  readonly addDraft: AddDraft;
  openSheetById(id: string): void;
  closeSheet(): void;
  setAddDraft(patch: Partial<AddDraft>): void;
  clearAddDraft(): void;
}

export const useUiStore = create<UiState>((set) => ({
  openSheet: null,
  addDraft: EMPTY_DRAFT,
  openSheetById: (id) => set({ openSheet: id }),
  closeSheet: () => set({ openSheet: null }),
  setAddDraft: (patch) => set((s) => ({ addDraft: { ...s.addDraft, ...patch } })),
  clearAddDraft: () => set({ addDraft: EMPTY_DRAFT }),
}));
