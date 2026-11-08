import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AccessibilityInfo, Animated, findNodeHandle, Keyboard, Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { announce } from '../a11y/announce';
import { useToastView } from './ToastHost';
import { useReducedMotion } from '../a11y/useReducedMotion';
import { copy } from '../copy';
import { Glass } from '../theme/Glass';
import { useTheme } from '../theme/ThemeProvider';
import { motion, radii } from '../theme/tokens';
import { textStyle } from '../theme/typography';

export interface SheetSpec {
  /** Stable id; opening a different id replaces the open sheet. */
  readonly id: string;
  readonly title: string;
  readonly body: (close: () => void) => ReactNode;
  /** Sticky footer content (solid, not a second glass layer). */
  readonly footer?: (close: () => void) => ReactNode;
}

interface SheetApi {
  readonly openId: string | null;
  /** `opener` receives focus again when the sheet closes. */
  open(spec: SheetSpec, opener?: RefObject<unknown>): void;
  close(): void;
}

const SheetContext = createContext<SheetApi | null>(null);

export function useSheet(): SheetApi {
  const api = useContext(SheetContext);
  if (!api) throw new Error('useSheet must be used inside <SheetHost>');
  return api;
}

/** Swipe distance (dp) or fling speed that dismisses the sheet. */
export const DISMISS_DISTANCE = 80;
export const DISMISS_VELOCITY = 0.8;
export const shouldDismiss = (dy: number, vy: number): boolean => dy > DISMISS_DISTANCE || vy > DISMISS_VELOCITY;

/**
 * One bottom sheet at a time: opening another replaces it, never stacks. Glass body, grabber,
 * scrim, solid sticky footer; Android Back, a tap on the scrim or a swipe down dismiss it;
 * focus is held inside while it is open and returns to the opener on close.
 */
export function SheetHost({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) {
  const [spec, setSpec] = useState<SheetSpec | null>(null);
  const openerRef = useRef<RefObject<unknown> | undefined>(undefined);

  const close = useCallback(() => {
    setSpec(null);
    const opener = openerRef.current;
    openerRef.current = undefined;
    if (opener?.current) {
      const node = findNodeHandle(opener.current as never);
      if (node) setTimeout(() => AccessibilityInfo.setAccessibilityFocus(node), 50);
    }
  }, []);

  const open = useCallback((next: SheetSpec, opener?: RefObject<unknown>) => {
    setSpec(next); // replaces whatever is open
    if (opener) openerRef.current = opener;
  }, []);

  useEffect(() => {
    onOpenChange?.(spec !== null);
  }, [spec, onOpenChange]);

  const api = useMemo<SheetApi>(() => ({ openId: spec?.id ?? null, open, close }), [spec?.id, open, close]);

  return (
    <SheetContext.Provider value={api}>
      {children}
      {spec ? <SheetView spec={spec} close={close} /> : null}
    </SheetContext.Provider>
  );
}

function SheetView({ spec, close }: { spec: SheetSpec; close: () => void }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const toastView = useToastView();
  const keyboard = useKeyboardHeight();
  const translateY = useRef(new Animated.Value(reduced ? 0 : 400)).current;

  useEffect(() => {
    announce(spec.title);
    if (reduced) return;
    Animated.timing(translateY, { toValue: 0, duration: motion.standard, useNativeDriver: true }).start();
  }, [reduced, spec.title, translateY]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => g.dy > 6,
        onPanResponderMove: (_e, g) => translateY.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_e, g) => {
          if (shouldDismiss(g.dy, g.vy)) close();
          else Animated.timing(translateY, { toValue: 0, duration: motion.fast, useNativeDriver: true }).start();
        },
      }),
    [close, translateY],
  );

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={close}>
      <View style={[styles.fill, { paddingBottom: keyboard }]} accessibilityViewIsModal>
        <Pressable
          testID="sheet-scrim"
          accessibilityRole="button"
          accessibilityLabel={copy.common.close}
          onPress={close}
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.color('scrim') }]}
        />
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <Glass style={styles.glass}>
            <View {...pan.panHandlers} style={styles.grabArea}>
              <View style={[styles.grabber, { backgroundColor: theme.color('on-glass-secondary') }]} />
            </View>
            <Text accessibilityRole="header" style={[textStyle('title'), styles.title, { color: theme.color('on-glass-primary') }]}>
              {spec.title}
            </Text>
            <View style={styles.body}>{spec.body(close)}</View>
            {spec.footer ? (
              <View testID="sheet-footer" style={[styles.footer, { backgroundColor: theme.color('glass-fallback'), paddingBottom: 12 + insets.bottom }]}>
                {spec.footer(close)}
              </View>
            ) : null}
          </Glass>
        </Animated.View>
        {toastView ? toastView('top', insets.top) : null}
      </View>
    </Modal>
  );
}

/** The soft keyboard's height, so a sheet (a Modal, which Android does not resize) can lift its fixed bar above it. */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  sheet: { width: '100%' },
  glass: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg },
  grabArea: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  grabber: { width: 32, height: 4, borderRadius: 2, opacity: 0.6 },
  title: { paddingHorizontal: 16 },
  body: { padding: 16 },
  footer: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
});
