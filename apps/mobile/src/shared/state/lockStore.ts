import { create } from 'zustand';

/**
 * App lock state (Story 8.3). `enabled` mirrors the device setting (filled before the first frame by the settings bridge);
 * `locked` is whether LockGate is covering the app. Plain functions (the re-authentication guard) read it without a component.
 */
interface LockState {
  readonly enabled: boolean;
  readonly locked: boolean;
  setEnabled(enabled: boolean): void;
  setLocked(locked: boolean): void;
}

export const useLockStore = create<LockState>((set) => ({
  enabled: false,
  locked: false,
  setEnabled: (enabled) => set({ enabled }),
  setLocked: (locked) => set({ locked }),
}));

export const isAppLockOn = (): boolean => useLockStore.getState().enabled;
export const isAppLocked = (): boolean => useLockStore.getState().locked;
