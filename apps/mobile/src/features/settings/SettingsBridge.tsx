import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { setInAppReduceMotion } from '../../shared/a11y/inAppMotion';
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
  const { setMode } = theme;
  useEffect(() => {
    if (mode) setMode(mode);
  }, [mode, setMode]);
  useEffect(() => {
    if (reduce !== undefined) setInAppReduceMotion(reduce);
  }, [reduce]);
  if (q.isLoading) return null;
  return <>{children}</>;
}
