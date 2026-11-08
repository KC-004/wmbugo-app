import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { resolveColor, type ColorName, type ColorScheme } from './colors';

/** The user's choice. There is no accent-colour option: the app is teal only. */
export type ThemeMode = 'system' | 'light' | 'dark';

export interface Theme {
  readonly mode: ThemeMode;
  /** The scheme actually in use (System resolves to the live OS setting). */
  readonly scheme: ColorScheme;
  setMode(mode: ThemeMode): void;
  color(name: ColorName): string;
}

const ThemeContext = createContext<Theme | null>(null);

/**
 * Provides the theme. `System` follows the OS live (useColorScheme re-renders on
 * change); Light and Dark are fixed. Persisting the choice is the Settings
 * story's job: pass `initialMode` in and listen with `onModeChange`.
 */
export function ThemeProvider({
  initialMode = 'system',
  onModeChange,
  children,
}: {
  initialMode?: ThemeMode;
  onModeChange?: (mode: ThemeMode) => void;
  children: ReactNode;
}) {
  const os = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>(initialMode);
  const scheme: ColorScheme = mode === 'system' ? (os === 'dark' ? 'dark' : 'light') : mode;

  const setMode = useCallback(
    (next: ThemeMode) => {
      setModeState(next);
      onModeChange?.(next);
    },
    [onModeChange],
  );

  const theme = useMemo<Theme>(
    () => ({ mode, scheme, setMode, color: (name) => resolveColor(scheme, name) }),
    [mode, scheme, setMode],
  );
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside <ThemeProvider>');
  return theme;
}
