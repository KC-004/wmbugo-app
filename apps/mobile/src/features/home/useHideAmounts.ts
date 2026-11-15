import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { announce } from '../../shared/a11y/announce';
import { copy } from '../../shared/copy';
import { isAmountsHidden, useAmountsStore } from '../../shared/state/amountsHidden';
import { SETTINGS_QUERY_KEY, type SettingsApi, type SettingsData } from '../settings/settingsApi';

/**
 * The eye (Story 5.3, HOM-008): flips Hide amounts in the same frame, tells TalkBack politely, and saves the setting so it
 * survives closing the app. If the save fails the mask goes back to what it was, so the screen never claims what is not stored.
 */
export function useToggleHideAmounts(api: Pick<SettingsApi, 'setHideAmounts'>): () => void {
  const qc = useQueryClient();
  return useCallback(() => {
    const previous = isAmountsHidden();
    const next = !previous;
    useAmountsStore.getState().setHidden(next);
    announce(next ? copy.home.hero.amountsHidden : copy.home.hero.amountsShown);
    // Only undo our own change: if the user has tapped again since, the newer state stands. Say what the screen now does.
    const revert = () => {
      if (isAmountsHidden() !== next) return;
      useAmountsStore.getState().setHidden(previous);
      announce(previous ? copy.home.hero.amountsHidden : copy.home.hero.amountsShown);
    };
    void api
      .setHideAmounts(next)
      .then((r) => {
        if (!r.ok) revert();
        else qc.setQueryData<SettingsData | null>(SETTINGS_QUERY_KEY, (d) => (d ? { ...d, settings: { ...d.settings, hideAmounts: next } } : d));
      })
      .catch(revert);
  }, [api, qc]);
}
