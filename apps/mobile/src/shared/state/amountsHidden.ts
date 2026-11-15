import { create } from 'zustand';

/**
 * Hide amounts (Story 5.3, HOM-008): one flag, read by every amount in the app. The setting (`ui.hide_amounts` in the profile
 * settings) is the source of truth; this store mirrors it so a toggle masks every screen in the same frame. It is filled from
 * the setting before the first frame (SettingsBridge) and written back by `useToggleHideAmounts`.
 */
interface AmountsState {
  readonly hidden: boolean;
  setHidden(hidden: boolean): void;
}

export const useAmountsStore = create<AmountsState>((set) => ({
  hidden: false,
  setHidden: (hidden) => set({ hidden }),
}));

/** Subscribes the calling component to the mask: it re-renders when Hide amounts is turned on or off. */
export const useAmountsHidden = (): boolean => useAmountsStore((s) => s.hidden);

/** The current value for plain functions (labels, money in sentences); components must also subscribe with `useAmountsHidden`. */
export const isAmountsHidden = (): boolean => useAmountsStore.getState().hidden;
