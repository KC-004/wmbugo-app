import { create } from 'zustand';

/**
 * Safe mode with a readable database (Story 8.12): `reason` is set when `quick_check` failed while the app is open. The writer
 * refuses every use case, the banner shows on every tab, and the Add button is disabled. null means normal operation.
 */
interface SafeModeState {
  readonly reason: string | null;
  setReason(reason: string | null): void;
}

export const useSafeModeStore = create<SafeModeState>((set) => ({
  reason: null,
  setReason: (reason) => set({ reason }),
}));

export const isInSafeMode = (): boolean => useSafeModeStore.getState().reason !== null;
