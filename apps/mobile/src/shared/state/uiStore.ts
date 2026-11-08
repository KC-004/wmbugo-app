import { create } from 'zustand';

/**
 * Transient UI state (see README.md in this folder). Later stories add the
 * open-sheet id and the Add draft here; nothing monetary or persistent.
 */
export interface UiState {
  readonly openSheet: string | null;
  openSheetById(id: string): void;
  closeSheet(): void;
}

export const useUiStore = create<UiState>((set) => ({
  openSheet: null,
  openSheetById: (id) => set({ openSheet: id }),
  closeSheet: () => set({ openSheet: null }),
}));
