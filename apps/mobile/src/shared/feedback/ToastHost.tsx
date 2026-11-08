import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { announce } from '../a11y/announce';
import { Button } from '../ui/Button';
import { useTheme } from '../theme/ThemeProvider';
import { textStyle } from '../theme/typography';
import { radii } from '../theme/tokens';
import { copy } from '../copy';
import { ToastController, type ToastRequest, type ToastState } from './toastController';

interface ToastApi {
  show(req: ToastRequest): void;
  dismiss(): void;
}

const ToastContext = createContext<ToastApi | null>(null);
/** Renders the current toast at a position; a sheet uses it to show the toast above its own scrim. */
const ToastViewContext = createContext<((position: 'bottom' | 'top', offset: number) => ReactNode) | null>(null);

export function useToastView(): ((position: 'bottom' | 'top', offset: number) => ReactNode) | null {
  return useContext(ToastViewContext);
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastHost>');
  return api;
}

/**
 * Hosts the single toast, drawn above the tab bar (`bottomOffset` = bar height). Pausing on touch or
 * focus and persisting under TalkBack are handled by the controller.
 */
export function ToastHost({ children, bottomOffset = 0 }: { children: ReactNode; bottomOffset?: number }) {
  const [state, setState] = useState<ToastState | null>(null);
  const screenReader = useRef(false);

  const controller = useMemo(
    () =>
      new ToastController({
        recommendedMs: (ms) => AccessibilityInfo.getRecommendedTimeoutMillis(ms),
        screenReaderOn: () => screenReader.current,
        announce,
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
        now: () => Date.now(),
        onChange: setState,
      }),
    [],
  );

  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then((v) => (screenReader.current = v));
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', (v) => (screenReader.current = v));
    return () => sub.remove();
  }, []);

  const api = useMemo<ToastApi>(() => ({ show: (r) => void controller.show(r), dismiss: () => controller.dismiss() }), [controller]);

  const renderView = useMemo(
    () => (position: 'bottom' | 'top', offset: number) => (state ? <ToastView state={state} controller={controller} position={position} offset={offset} /> : null),
    [state, controller],
  );

  return (
    <ToastContext.Provider value={api}>
      <ToastViewContext.Provider value={renderView}>
        {children}
        {renderView('bottom', bottomOffset)}
      </ToastViewContext.Provider>
    </ToastContext.Provider>
  );
}

function ToastView({ state, controller, position, offset }: { state: ToastState; controller: ToastController; position: 'bottom' | 'top'; offset: number }) {
  const theme = useTheme();
  // Inverse colours (DESIGN.md Toast): light = text-primary background, dark = bg-muted-dark.
  const dark = theme.scheme === 'dark';
  const bg = dark ? theme.color('bg-muted') : theme.color('text-primary');
  const ink = dark ? theme.color('text-primary') : theme.color('bg-canvas');
  return (
    <View
      testID="toast"
      onTouchStart={() => controller.pause()}
      onTouchEnd={() => controller.resume()}
      onTouchCancel={() => controller.resume()}
      style={[styles.toast, position === 'bottom' ? { bottom: offset + 16 } : { top: offset + 16 }, { backgroundColor: bg, borderColor: theme.color('glass-border') }, dark ? styles.bordered : null]}>
      <Text style={[textStyle('body'), styles.message, { color: ink }]}>{state.message}</Text>
      {state.choices?.map((c, i) => (
        <Button key={c.label} label={c.label} variant="text" onGlass onPress={() => controller.choose(i)} testID={`toast-choice-${i}`} onFocusChange={(f) => (f ? controller.pause() : controller.resume())} />
      ))}
      {state.undo ? (
        <Button
          label={state.undo.label ?? copy.common.undo}
          variant="text"
          onGlass
          onPress={() => controller.undo()}
          testID="toast-undo"
          onFocusChange={(f) => (f ? controller.pause() : controller.resume())}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    minHeight: 48,
    borderRadius: radii.md,
    paddingLeft: 16,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bordered: { borderWidth: 1 },
  message: { flex: 1 },
});
