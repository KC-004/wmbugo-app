import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { toLocalDate } from '@wmbugo/core';

/** How long a recompute may take before the cards say `Updating…` (Story 5.1). */
export const SLOW_REFRESH_MS = 300;
/** How often an open Home checks whether the local date has moved on (midnight or a period boundary). */
export const DATE_CHECK_MS = 30_000;

/** True once `active` has stayed true for `ms`; false again as soon as it ends. Quick refreshes never flash. */
export function useSlowFlag(active: boolean, ms: number = SLOW_REFRESH_MS): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return slow;
}

/**
 * Keeps an open Home current beyond what events cover: when the app comes back to the foreground, and when the local date
 * moves on while it is open (midnight, or a period boundary). Both call `refresh`, which recomputes every Home query.
 */
export function useHomeRefresh({ today, timezoneId, nowMs, refresh }: { today: string | undefined; timezoneId: string | undefined; nowMs: () => number; refresh: () => void }): void {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  useEffect(() => {
    if (!today || !timezoneId) return;
    const id = setInterval(() => {
      const now = toLocalDate(nowMs(), timezoneId);
      if (now.ok && now.value !== today) refresh();
    }, DATE_CHECK_MS);
    return () => clearInterval(id);
  }, [today, timezoneId, nowMs, refresh]);
}
