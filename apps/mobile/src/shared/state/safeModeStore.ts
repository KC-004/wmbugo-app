import { create } from 'zustand';

/**
 * Safe mode with a readable database (Story 8.12): `reason` is set when `quick_check` failed while the app is open. The writer
 * refuses every use case, the banner shows on every tab, and the Add button is disabled. null means normal operation.
 */
interface SafeModeState {
  readonly reason: string | null;
  setReason(reason: string | null): void;
  /**
   * The code of a start that failed (`start_DATABASE_OPEN_FAILED`): kept only so Diagnostics can show it when there are no
   * services to ask. It does not put the app in safe mode with a banner, and a start that succeeds clears it.
   */
  readonly startFailure: string | null;
  setStartFailure(code: string | null): void;
}

export const useSafeModeStore = create<SafeModeState>((set) => ({
  reason: null,
  setReason: (reason) => set({ reason }),
  startFailure: null,
  setStartFailure: (startFailure) => set({ startFailure }),
}));

export const isInSafeMode = (): boolean => useSafeModeStore.getState().reason !== null;
