import { useSyncExternalStore } from 'react';

/** The in-app "Reduce motion" choice (Settings > You > Appearance), mirrored here so any component can read it. */
let on = false;
const listeners = new Set<() => void>();

export function setInAppReduceMotion(value: boolean): void {
  if (on === value) return;
  on = value;
  listeners.forEach((l) => l());
}

export function useInAppReduceMotion(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => on,
    () => false,
  );
}
