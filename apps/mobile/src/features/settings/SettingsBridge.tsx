import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { setInAppReduceMotion } from '../../shared/a11y/inAppMotion';
import { useAmountsStore } from '../../shared/state/amountsHidden';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { realSettingsApi, SETTINGS_QUERY_KEY, type SettingsApi } from './settingsApi';

/**
 * Applies the saved theme and the in-app "Reduce motion" choice to the whole app, and keeps them current when a
 * setting changes. It waits for the first read so the saved theme is on the first frame; if the read fails the
 * app still opens with the defaults.
 */
export function SettingsBridge({ api = realSettingsApi, children }: { api?: SettingsApi; children: ReactNode }) {
  const theme = useTheme();
  const q = useQuery({ queryKey: SETTINGS_QUERY_KEY, queryFn: () => api.load() });
  const mode = q.data?.settings.theme;
  const reduce = q.data?.settings.reduceMotion;
  const hideAmounts = q.data?.settings.hideAmounts;
  const { setMode } = theme;
  useEffect(() => {
    if (mode) setMode(mode);
  }, [mode, setMode]);
  useEffect(() => {
    if (reduce !== undefined) setInAppReduceMotion(reduce);
  }, [reduce]);
  // Hide amounts is read before the first frame, so a masked app never flashes its amounts on opening (Story 5.3).
  useLayoutEffect(() => {
    if (hideAmounts !== undefined) useAmountsStore.getState().setHidden(hideAmounts);
    // The saved choice could not be read: keep amounts hidden rather than show money the user may have hidden.
    else if (q.isError) useAmountsStore.getState().setHidden(true);
  }, [hideAmounts, q.isError]);
  if (q.isLoading) return null;
  return <>{children}</>;
}
