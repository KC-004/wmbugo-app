/**
 * A save asks for the one-time app lock offer (Story 8.4) without knowing who shows it: the Add sheet closes right after a
 * save, so the offer lives in a host above it (`AppLockOfferHost`). `schedule` is called after a save succeeds, `cancel` when the
 * person undoes it before the offer appears.
 */
type Listener = { schedule(): void; cancel(): void };
let listener: Listener | null = null;

export function registerAppLockOfferHost(l: Listener): () => void {
  listener = l;
  return () => {
    if (listener === l) listener = null;
  };
}

export const scheduleAppLockOffer = (): void => listener?.schedule();
export const cancelAppLockOffer = (): void => listener?.cancel();
